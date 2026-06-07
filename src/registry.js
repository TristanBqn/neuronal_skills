import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileP = promisify(execFile);
let cache = null;
const TTL_MS = 60_000;
export async function loadRegistry() {
    if (cache && Date.now() - cache.at < TTL_MS)
        return cache.data;
    const candidates = [
        ["plugins", "inspect", "--all", "--runtime", "--json"],
        ["plugins", "inspect", "--all", "--json"],
        ["plugins", "list", "--json"],
    ];
    let raw = null;
    for (const args of candidates) {
        try {
            const { stdout } = await execFileP("openclaw", args, { maxBuffer: 16 * 1024 * 1024 });
            raw = JSON.parse(stdout);
            break;
        }
        catch {
            // fallthrough to next candidate
        }
    }
    const data = normalize(raw);
    cache = { at: Date.now(), data };
    return data;
}
function normalize(raw) {
    if (!raw)
        return [];
    const list = Array.isArray(raw)
        ? raw
        : Array.isArray(raw.plugins)
            ? raw.plugins
            : Array.isArray(raw.items)
                ? raw.items
                : [];
    return list
        .map((p) => {
        const id = p.id || p.manifest?.id;
        if (!id)
            return null;
        const name = p.name || p.manifest?.name || id;
        return {
            id,
            name,
            short: shortName(id),
            files: extractFiles(p),
            tools: extractTools(p),
            desc: p.description || p.manifest?.description || "",
        };
    })
        .filter((x) => x !== null);
}
function shortName(id) {
    return id.split(/[-_:/]/)[0].toLowerCase();
}
function extractFiles(p) {
    const candidates = [
        p.files,
        p.manifest?.files,
        p.openclaw?.extensions,
        p.extensions,
        p.runtime?.files,
        p.entries,
    ];
    for (const c of candidates) {
        if (Array.isArray(c) && c.length)
            return c.map(String);
    }
    return [];
}
function extractTools(p) {
    const candidates = [
        p.contracts?.tools,
        p.manifest?.contracts?.tools,
        p.runtime?.tools,
        p.tools,
    ];
    for (const c of candidates) {
        if (Array.isArray(c) && c.length)
            return c.map(String);
        if (c && typeof c === "object") {
            const keys = Object.keys(c);
            if (keys.length)
                return keys;
        }
    }
    return [];
}
export function buildToolToPluginIndex(registry) {
    const idx = new Map();
    for (const p of registry) {
        for (const t of p.tools) {
            if (!idx.has(t))
                idx.set(t, p.id);
        }
    }
    return idx;
}
