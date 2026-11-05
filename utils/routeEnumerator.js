/**
 * routeEnumerator.js — walks the Express app and returns every registered
 * route as { method, path } with mount prefixes resolved. Used by the
 * route-authorization test (Phase 6.2) so a new unclassified route fails CI.
 */
function mountPath(layer) {
    // Express 4 stores the mount regexp on layer.regexp; path-to-regexp source
    // looks like "^\\/api\\/v1\\/chat\\/?(?=\\/|$)". Extract the literal parts.
    const src = layer.regexp && layer.regexp.source;
    if (!src || src === "^\\/?(?=\\/|$)") return "";
    const m = src.match(/^\^((?:\\\/[^()$?]+)+)/);
    if (!m) return "";
    return m[1].replace(/\\\//g, "/").replace(/\\/g, "");
}

function enumerateRoutes(app) {
    const routes = [];
    const walk = (stack, prefix) => {
        for (const layer of stack) {
            if (layer.route) {
                const path = prefix + layer.route.path;
                for (const method of Object.keys(layer.route.methods)) {
                    if (layer.route.methods[method]) {
                        routes.push({ method: method.toUpperCase(), path });
                    }
                }
            } else if (layer.name === "router" && layer.handle && layer.handle.stack) {
                walk(layer.handle.stack, prefix + mountPath(layer));
            }
        }
    };
    const router = app._router || app.router;
    if (!router) return routes;
    walk(router.stack, "");
    return routes;
}

module.exports = { enumerateRoutes };
