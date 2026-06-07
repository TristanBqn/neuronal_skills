import { createReadStream, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
// A skill is "engaged" when the model loads its SKILL.md in a tool call.
// This is a proxy: OpenClaw emits no skill-activation event, so reading the
// skill body is the closest observable signal of natural (model-chosen) use.
const SKILL_RE = /skills\/([a-z0-9_-]+)\/SKILL\.md/gi;
/**
 * Group a tool name into a plugin/family bucket.
 *   "codex_apps.github_search" -> "codex_apps"  (connector: has a dot)
 *   "memory_store"             -> "memory"
 *   "bash"                     -> "bash"
 */
function groupKey(tool) {
    const dot = tool.indexOf(".");
    if (dot > 0)
        return tool.slice(0, dot);
    const us = tool.indexOf("_");
    if (us > 0)
        return tool.slice(0, us);
    return tool;
}
export async function generateSnapshot(input) {
    const cutoff = Date.now() - input.windowDays * 24 * 60 * 60 * 1000;
    const calls = new Map(); // group -> count
    const toolsByGroup = new Map(); // group -> distinct tool/skill names
    const connectors = new Set(); // groups derived from dotted (namespaced) tools
    const turnMembership = new Map(); // turnId -> set of groups
    let events = 0;
    const sourceFiles = collectTrajectoryFiles(input.sessionsDir, cutoff);
    if (sourceFiles.length === 0) {
        input.logger?.warn?.(`No *.trajectory.jsonl files found under ${input.sessionsDir}`);
    }
    else {
        input.logger?.info?.(`Scanning ${sourceFiles.length} trajectory file(s).`);
    }
    for (const file of sourceFiles) {
        events += await consumeFile(file, cutoff, calls, toolsByGroup, connectors, turnMembership);
    }
    // Keep connectors (real integrations), skills, and an explicit core allowlist.
    const keep = (g) => g.startsWith("skill:") || connectors.has(g) || input.includeGroups.includes(g);
    const turnsByGroup = countTurns(turnMembership, keep);
    const plugins = buildPluginNodes(calls, toolsByGroup, turnsByGroup, connectors, keep, input.windowDays);
    const links = buildLinks(turnMembership, keep);
    const fileCount = plugins.reduce((acc, p) => acc + (p.kind === "skill" ? 0 : p.files.length), 0);
    const skillCount = plugins.filter((p) => p.kind === "skill").length;
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
    return { plugins: plugins.length, links: links.length, events, files: fileCount, skills: skillCount };
}
/**
 * Recursively collect *.trajectory.jsonl files under the sessions directory.
 * Files whose last modification predates the window are skipped entirely.
 */
function collectTrajectoryFiles(root, cutoffMs) {
    if (!existsSync(root))
        return [];
    const out = [];
    let entries;
    try {
        entries = readdirSync(root, { recursive: true });
    }
    catch {
        return out;
    }
    for (const rel of entries) {
        if (!rel.endsWith(".trajectory.jsonl"))
            continue;
        const abs = path.join(root, rel);
        try {
            const st = statSync(abs);
            if (!st.isFile() || st.mtimeMs < cutoffMs)
                continue;
            out.push(abs);
        }
        catch {
            // unreadable entry, skip
        }
    }
    return out;
}
async function consumeFile(file, cutoffMs, calls, toolsByGroup, connectors, turnMembership) {
    const rl = createInterface({
        input: createReadStream(file),
        crlfDelay: Infinity,
    });
    const bump = (group, label, turnBucket) => {
        calls.set(group, (calls.get(group) || 0) + 1);
        let tset = toolsByGroup.get(group);
        if (!tset) {
            tset = new Set();
            toolsByGroup.set(group, tset);
        }
        tset.add(label);
        if (turnBucket)
            turnBucket.add(group);
    };
    let total = 0;
    for await (const line of rl) {
        if (!line || line.charCodeAt(0) !== 123 /* '{' */)
            continue;
        let ev;
        try {
            ev = JSON.parse(line);
        }
        catch {
            continue;
        }
        if (ev.type !== "tool.call")
            continue;
        const tool = ev.data?.name;
        if (!tool)
            continue;
        const tsMs = ev.ts ? Date.parse(ev.ts) : NaN;
        if (!Number.isFinite(tsMs) || tsMs < cutoffMs)
            continue;
        // Resolve the turn bucket once; both the tool group and any engaged skills
        // share it so co-occurrence is computed against the native turn id.
        const turnId = ev.data?.turnId || ev.sessionKey || ev.sessionId;
        let bucket = null;
        if (turnId) {
            bucket = turnMembership.get(turnId) ?? null;
            if (!bucket) {
                bucket = new Set();
                turnMembership.set(turnId, bucket);
            }
        }
        const group = groupKey(tool);
        if (tool.includes("."))
            connectors.add(group);
        bump(group, tool, bucket);
        total++;
        // Skill engagement: SKILL.md reads in the call arguments (skip edits).
        if (tool !== "apply_patch") {
            const argsStr = JSON.stringify(ev.data?.arguments ?? "");
            SKILL_RE.lastIndex = 0;
            let m;
            const seen = new Set();
            while ((m = SKILL_RE.exec(argsStr))) {
                const sid = `skill:${m[1]}`;
                if (seen.has(sid))
                    continue; // count once per event
                seen.add(sid);
                bump(sid, m[1], bucket);
            }
        }
    }
    return total;
}
function maxOf(m) {
    let max = 1;
    for (const v of m.values())
        if (v > max)
            max = v;
    return max;
}
/** Distinct turns each kept group appeared in. */
function countTurns(turnMembership, keep) {
    const turns = new Map();
    for (const set of turnMembership.values()) {
        for (const g of set) {
            if (!keep(g))
                continue;
            turns.set(g, (turns.get(g) || 0) + 1);
        }
    }
    return turns;
}
function buildPluginNodes(calls, toolsByGroup, turnsByGroup, connectors, keep, windowDays) {
    const kept = new Map();
    for (const [g, c] of calls.entries())
        if (keep(g))
            kept.set(g, c);
    const maxCount = maxOf(kept);
    const out = [];
    for (const [group, c] of kept.entries()) {
        const tools = Array.from(toolsByGroup.get(group) ?? []).sort();
        const turns = turnsByGroup.get(group) || 0;
        if (group.startsWith("skill:")) {
            const name = group.slice("skill:".length);
            out.push({
                id: group,
                name: `skill: ${name}`,
                short: name,
                usage: c / maxCount,
                calls: c,
                turns,
                kind: "skill",
                desc: `Skill chargé dans ${turns} tour(s) sur ${windowDays} jours (proxy : lecture du SKILL.md).`,
                files: [`${name}/SKILL.md`],
            });
            continue;
        }
        const kind = connectors.has(group) ? "plugin" : "core";
        out.push({
            id: group,
            name: group,
            short: group,
            usage: c / maxCount,
            calls: c,
            turns,
            kind,
            desc: `${kind === "plugin" ? "Plugin" : "Outil cœur"} · ${tools.length} outil(s) · ${c} appel(s) sur ${windowDays} jours.`,
            files: tools.length ? tools : [group],
        });
    }
    out.sort((a, b) => b.calls - a.calls);
    return out;
}
function buildLinks(turnMembership, keep) {
    const pairCounts = new Map();
    for (const set of turnMembership.values()) {
        const arr = Array.from(set).filter(keep);
        if (arr.length < 2)
            continue;
        for (let i = 0; i < arr.length; i++) {
            for (let j = i + 1; j < arr.length; j++) {
                const [a, b] = arr[i] < arr[j] ? [arr[i], arr[j]] : [arr[j], arr[i]];
                const k = `${a}|${b}`;
                pairCounts.set(k, (pairCounts.get(k) || 0) + 1);
            }
        }
    }
    const max = maxOf(pairCounts);
    const links = [];
    for (const [k, c] of pairCounts.entries()) {
        const [a, b] = k.split("|");
        links.push([a, b, c / max, c]);
    }
    return links;
}
