/**
 * sseRegistry.js — tracks open SSE responses so graceful shutdown can end
 * them cleanly instead of leaving clients hanging until server.close's
 * keep-alive timeout kills the sockets (Phase 6.3).
 */
const open = new Set();

/** Register an SSE response; auto-unregisters when it ends/closes. */
function register(res) {
    open.add(res);
    const off = () => open.delete(res);
    res.on("close", off);
    res.on("finish", off);
    return () => off();
}

/**
 * End every open SSE stream with a final event so clients see a clean
 * termination (and persist partial output) rather than a dropped socket.
 */
function closeAll(finalEvent = { type: "done", truncated: true, reason: "server-shutdown" }) {
    for (const res of [...open]) {
        try {
            if (!res.writableEnded) {
                res.write(`data: ${JSON.stringify(finalEvent)}\n\n`);
                res.end();
            }
        } catch { /* socket already gone */ }
    }
    open.clear();
}

module.exports = { register, closeAll, _size: () => open.size };
