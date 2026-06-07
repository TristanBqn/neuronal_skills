import { Type } from "typebox";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { generateSnapshot } from "./src/aggregate.js";
import { ensureViewerServer } from "./src/server.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export default definePluginEntry({
    id: "plugin-network",
    name: "Plugin Network",
    description: "Neural-net visualization of OpenClaw plugin usage, served over a localhost HTTP endpoint for remote tunneling.",
    register(api) {
        api.registerTool({
            name: "plugin_network_open",
            description: "Generate the latest plugin-usage snapshot from telemetry and serve the interactive network viewer on a localhost port. Use an SSH tunnel from your workstation to reach it.",
            parameters: Type.Object({
                windowDays: Type.Optional(Type.Number({ description: "Override the configured time window in days." })),
                regenerateOnly: Type.Optional(Type.Boolean({ description: "Only refresh data.json, do not start the viewer server." })),
            }),
            async execute(_id, params) {
                const cfg = (api.pluginConfig || {});
                const windowDays = params.windowDays ?? cfg.windowDays ?? 30;
                const sessionsDir = cfg.sessionsDir || path.join(os.homedir(), ".openclaw", "agents");
                // Connectors (dotted tool names like "codex_apps.*") are always kept;
                // this allowlist adds the bare core tools worth surfacing next to them.
                const includeGroups = cfg.includeGroups ?? ["bash", "cron", "message", "memory"];
                const port = cfg.port ?? 8742;
                // Default 0.0.0.0: the plugin runs in-process inside the Docker
                // container, so binding to container-loopback would be unreachable from
                // the host. Safety comes from the Docker port mapping (-p 127.0.0.1:PORT:PORT),
                // not from this bind. On bare-metal, set bindHost to 127.0.0.1 instead.
                const bindHost = cfg.bindHost ?? "0.0.0.0";
                // Floor at 1 min so a misconfigured 0 doesn't kill the server instantly.
                const idleShutdownMs = Math.max(1, cfg.idleShutdownMinutes ?? 30) * 60 * 1000;
                const viewerDir = path.join(__dirname, "viewer");
                const outputPath = path.join(viewerDir, "data.json");
                const summary = await generateSnapshot({
                    sessionsDir,
                    windowDays,
                    outputPath,
                    includeGroups,
                    logger: api.logger,
                });
                const summaryLine = `Snapshot: ${summary.plugins} nœuds · ${summary.files} outils · ` +
                    `${summary.links} liens · ${summary.events} appels · fenêtre ${windowDays}j.`;
                if (params.regenerateOnly) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: `${summaryLine}\nViewer not started (regenerateOnly=true). data.json written to:\n${outputPath}`,
                            },
                        ],
                    };
                }
                let serve;
                try {
                    serve = await ensureViewerServer({
                        viewerDir,
                        port,
                        host: bindHost,
                        idleShutdownMs,
                        logger: api.logger,
                    });
                }
                catch (err) {
                    const reason = err?.code === "EADDRINUSE"
                        ? `Port ${port} is already in use. Change the port in plugin config or free it first.`
                        : `Failed to start viewer server: ${err?.message || err}`;
                    return { content: [{ type: "text", text: `${summaryLine}\nError: ${reason}` }] };
                }
                const tunnelHint = bindHost === "127.0.0.1" || bindHost === "localhost"
                    ? `Bare-metal bind (${bindHost}:${port}). From your workstation:\n  ssh -L ${port}:127.0.0.1:${port} <user>@<vps>\nThen open http://localhost:${port}/`
                    : `Listening on ${bindHost}:${port} inside the container.\n  1. Docker must publish it loopback-only:  -p 127.0.0.1:${port}:${port}\n  2. From your workstation:  ssh -L ${port}:127.0.0.1:${port} <user>@<vps>\n  3. Open http://localhost:${port}/`;
                const reuseHint = serve.reused
                    ? "Server was already running; idle timer reset."
                    : "Server started.";
                const idleHint = `Auto-shutdown after ${cfg.idleShutdownMinutes ?? 30}min of inactivity (next at ${serve.expiresAt}).`;
                const emptyWarning = summary.events === 0
                    ? "\nAttention : 0 appel trouvé. Vérifie qu'il existe des fichiers *.trajectory.jsonl sous " +
                        sessionsDir
                    : "";
                return {
                    content: [
                        {
                            type: "text",
                            text: `${summaryLine}\n${reuseHint} ${idleHint}\n${tunnelHint}${emptyWarning}`,
                        },
                    ],
                };
            },
        });
    },
});
