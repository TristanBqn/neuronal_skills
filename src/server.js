import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
let active = null;
const MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".jsx": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".map": "application/json; charset=utf-8",
};
export async function ensureViewerServer(opts) {
    if (active && active.port === opts.port && active.host === opts.host) {
        active.touch();
        return {
            url: `http://${publicHost(opts.host)}:${opts.port}/`,
            port: opts.port,
            host: opts.host,
            reused: true,
            expiresAt: new Date(Date.now() + active.idleMs).toISOString(),
        };
    }
    if (active) {
        active.shutdown();
        active = null;
    }
    const root = path.resolve(opts.viewerDir);
    const server = http.createServer((req, res) => {
        if (active)
            active.touch();
        handle(req, res, root).catch((err) => {
            opts.logger?.warn?.(`viewer server error: ${err?.message || err}`);
            if (!res.headersSent) {
                res.writeHead(500, { "Content-Type": "text/plain" });
                res.end("Internal Server Error");
            }
        });
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(opts.port, opts.host, () => {
            server.off("error", reject);
            resolve();
        });
    });
    let idleTimer = null;
    const touch = () => {
        if (idleTimer)
            clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            opts.logger?.info?.(`viewer server idle ${opts.idleShutdownMs}ms — shutting down`);
            shutdown();
        }, opts.idleShutdownMs);
        idleTimer.unref?.();
    };
    const shutdown = () => {
        if (idleTimer)
            clearTimeout(idleTimer);
        server.close();
        if (active && active.port === opts.port)
            active = null;
    };
    active = {
        port: opts.port,
        host: opts.host,
        startedAt: Date.now(),
        idleMs: opts.idleShutdownMs,
        shutdown,
        touch,
    };
    touch();
    opts.logger?.info?.(`viewer server listening on http://${opts.host}:${opts.port}/ (idle shutdown ${opts.idleShutdownMs}ms)`);
    return {
        url: `http://${publicHost(opts.host)}:${opts.port}/`,
        port: opts.port,
        host: opts.host,
        reused: false,
        expiresAt: new Date(Date.now() + opts.idleShutdownMs).toISOString(),
    };
}
function publicHost(bind) {
    // Bind addresses like 0.0.0.0 / :: are not useful in a printed URL.
    if (bind === "0.0.0.0" || bind === "::" || bind === "::0")
        return "localhost";
    return bind;
}
async function handle(req, res, root) {
    if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { Allow: "GET, HEAD" });
        res.end();
        return;
    }
    let urlPath;
    try {
        urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    }
    catch {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Bad Request");
        return;
    }
    let rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
    // Block path traversal: resolved path must stay inside root.
    const abs = path.resolve(root, rel);
    if (!abs.startsWith(root + path.sep) && abs !== root) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("Forbidden");
        return;
    }
    if (!existsSync(abs) || !statSync(abs).isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
        return;
    }
    const ext = path.extname(abs).toLowerCase();
    const mime = MIME[ext] || "application/octet-stream";
    res.writeHead(200, {
        "Content-Type": mime,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    });
    if (req.method === "HEAD") {
        res.end();
        return;
    }
    createReadStream(abs).pipe(res);
}
