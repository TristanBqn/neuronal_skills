import { createReadStream, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";

export interface SnapshotInput {
  // Directory holding agent sessions, e.g. ~/.openclaw/agents.
  // We recursively scan it for *.trajectory.jsonl files.
  sessionsDir: string;
  windowDays: number;
  outputPath: string;
  // Non-connector groups to keep (connectors — dotted tool names like
  // "codex_apps.*" — are always kept automatically). Everything else is dropped.
  includeGroups: string[];
  logger?: { info?: (m: string) => void; warn?: (m: string) => void };
}

export interface SnapshotSummary {
  plugins: number;
  links: number;
  events: number;
  files: number;
}

interface PluginNode {
  id: string;
  name: string;
  short: string;
  usage: number; // 0..1 normalized against the busiest kept group
  calls: number; // raw tool.call count
  turns: number; // distinct turns this group appeared in (for directional %)
  desc: string;
  files: string[]; // individual tool names -> rendered as neurons
}

// LINKS carry both a visual weight (globally normalized, 0..1) and the raw
// co-occurrence turn count, so the UI can show a *directional* ratio
// (coTurns / node.turns) without re-deriving it.
type Link = [string, string, number, number];

interface TrajectoryEvent {
  type?: string;
  ts?: string;
  sessionKey?: string;
  sessionId?: string;
  data?: { name?: string; turnId?: string };
}

/**
 * Group a tool name into a plugin/family bucket.
 *   "codex_apps.github_search" -> "codex_apps"  (connector: has a dot)
 *   "memory_store"             -> "memory"
 *   "bash"                     -> "bash"
 */
function groupKey(tool: string): string {
  const dot = tool.indexOf(".");
  if (dot > 0) return tool.slice(0, dot);
  const us = tool.indexOf("_");
  if (us > 0) return tool.slice(0, us);
  return tool;
}

export async function generateSnapshot(input: SnapshotInput): Promise<SnapshotSummary> {
  const cutoff = Date.now() - input.windowDays * 24 * 60 * 60 * 1000;

  const calls = new Map<string, number>(); // group -> total tool.call count
  const toolsByGroup = new Map<string, Set<string>>(); // group -> distinct tool names
  const connectors = new Set<string>(); // groups derived from dotted (namespaced) tools
  const turnMembership = new Map<string, Set<string>>(); // turnId -> set of groups
  let events = 0;

  const sourceFiles = collectTrajectoryFiles(input.sessionsDir, cutoff);
  if (sourceFiles.length === 0) {
    input.logger?.warn?.(`No *.trajectory.jsonl files found under ${input.sessionsDir}`);
  } else {
    input.logger?.info?.(`Scanning ${sourceFiles.length} trajectory file(s).`);
  }

  for (const file of sourceFiles) {
    events += await consumeFile(file, cutoff, calls, toolsByGroup, connectors, turnMembership);
  }

  // Keep connectors (real plugins/integrations) + an explicit allowlist.
  const keep = (g: string) => connectors.has(g) || input.includeGroups.includes(g);

  const turnsByGroup = countTurns(turnMembership, keep);
  const plugins = buildPluginNodes(calls, toolsByGroup, turnsByGroup, keep, input.windowDays);
  const links = buildLinks(turnMembership, keep);
  const fileCount = plugins.reduce((acc, p) => acc + p.files.length, 0);

  const payload = {
    generatedAt: new Date().toISOString(),
    windowDays: input.windowDays,
    totalEvents: events,
    source: input.sessionsDir,
    PLUGINS: plugins,
    LINKS: links,
  };

  mkdirSync(path.dirname(input.outputPath), { recursive: true });
  await writeFile(input.outputPath, JSON.stringify(payload, null, 2), "utf8");

  return { plugins: plugins.length, links: links.length, events, files: fileCount };
}

/**
 * Recursively collect *.trajectory.jsonl files under the sessions directory.
 * Files whose last modification predates the window are skipped entirely
 * (every event they hold is older than the cutoff).
 */
function collectTrajectoryFiles(root: string, cutoffMs: number): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root, { recursive: true }) as string[];
  } catch {
    return out;
  }
  for (const rel of entries) {
    if (!rel.endsWith(".trajectory.jsonl")) continue;
    const abs = path.join(root, rel);
    try {
      const st = statSync(abs);
      if (!st.isFile() || st.mtimeMs < cutoffMs) continue;
      out.push(abs);
    } catch {
      // unreadable entry, skip
    }
  }
  return out;
}

async function consumeFile(
  file: string,
  cutoffMs: number,
  calls: Map<string, number>,
  toolsByGroup: Map<string, Set<string>>,
  connectors: Set<string>,
  turnMembership: Map<string, Set<string>>
): Promise<number> {
  const rl = createInterface({
    input: createReadStream(file),
    crlfDelay: Infinity,
  });

  let total = 0;
  for await (const line of rl) {
    if (!line || line.charCodeAt(0) !== 123 /* '{' */) continue;
    let ev: TrajectoryEvent;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.type !== "tool.call") continue;

    const tool = ev.data?.name;
    if (!tool) continue;

    const tsMs = ev.ts ? Date.parse(ev.ts) : NaN;
    if (!Number.isFinite(tsMs) || tsMs < cutoffMs) continue;

    const group = groupKey(tool);
    if (tool.includes(".")) connectors.add(group);
    calls.set(group, (calls.get(group) || 0) + 1);

    let tset = toolsByGroup.get(group);
    if (!tset) {
      tset = new Set();
      toolsByGroup.set(group, tset);
    }
    tset.add(tool);
    total++;

    // Native turn id gives exact co-occurrence; fall back to session if absent.
    const turnId = ev.data?.turnId || ev.sessionKey || ev.sessionId;
    if (!turnId) continue;
    let bucket = turnMembership.get(turnId);
    if (!bucket) {
      bucket = new Set();
      turnMembership.set(turnId, bucket);
    }
    bucket.add(group);
  }
  return total;
}

function maxOf(m: Map<string, number>): number {
  let max = 1;
  for (const v of m.values()) if (v > max) max = v;
  return max;
}

/** Distinct turns each kept group appeared in. */
function countTurns(
  turnMembership: Map<string, Set<string>>,
  keep: (g: string) => boolean
): Map<string, number> {
  const turns = new Map<string, number>();
  for (const set of turnMembership.values()) {
    for (const g of set) {
      if (!keep(g)) continue;
      turns.set(g, (turns.get(g) || 0) + 1);
    }
  }
  return turns;
}

function buildPluginNodes(
  calls: Map<string, number>,
  toolsByGroup: Map<string, Set<string>>,
  turnsByGroup: Map<string, number>,
  keep: (g: string) => boolean,
  windowDays: number
): PluginNode[] {
  const kept = new Map<string, number>();
  for (const [g, c] of calls.entries()) if (keep(g)) kept.set(g, c);
  const maxCount = maxOf(kept);

  const out: PluginNode[] = [];
  for (const [group, c] of kept.entries()) {
    const tools = Array.from(toolsByGroup.get(group) ?? []).sort();
    out.push({
      id: group,
      name: group,
      short: group,
      usage: c / maxCount,
      calls: c,
      turns: turnsByGroup.get(group) || 0,
      desc: `${tools.length} outil(s) · ${c} appel(s) sur ${windowDays} jours.`,
      files: tools.length ? tools : [group],
    });
  }
  out.sort((a, b) => b.calls - a.calls);
  return out;
}

function buildLinks(
  turnMembership: Map<string, Set<string>>,
  keep: (g: string) => boolean
): Link[] {
  const pairCounts = new Map<string, number>();
  for (const set of turnMembership.values()) {
    const arr = Array.from(set).filter(keep);
    if (arr.length < 2) continue;
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const [a, b] = arr[i] < arr[j] ? [arr[i], arr[j]] : [arr[j], arr[i]];
        const k = `${a}|${b}`;
        pairCounts.set(k, (pairCounts.get(k) || 0) + 1);
      }
    }
  }
  const max = maxOf(pairCounts);
  const links: Link[] = [];
  for (const [k, c] of pairCounts.entries()) {
    const [a, b] = k.split("|");
    links.push([a, b, c / max, c]);
  }
  return links;
}
