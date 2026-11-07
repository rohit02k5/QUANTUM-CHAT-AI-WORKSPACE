/**
 * llm-smoke.js — one tiny live call per configured provider (Phase 6A).
 *
 *   node scripts/llm-smoke.js
 *
 * Prints provider, model, latency, and a 1-word reply for every enabled
 * provider. Never prints keys or request bodies. Exit 1 if a configured
 * provider fails.
 */
require("dotenv").config();

const llm = require("../utils/llm");

async function main() {
    const enabled = llm.enabledProviders();
    if (!enabled.length) {
        console.log("[llm-smoke] no providers enabled (check *_API_KEY env)");
        process.exit(1);
    }
    let failures = 0;
    for (const p of enabled) {
        const t0 = Date.now();
        try {
            // Direct provider call (not the router) — smoke this provider only.
            const res = await p.generate({
                model: p.modelName,
                contents: [{ role: "user", parts: [{ text: "Reply with exactly one word: ok" }] }],
                config: { maxOutputTokens: 16, temperature: 0 },
            });
            const text = (res.text || "").trim().slice(0, 40);
            console.log(`[llm-smoke] ${p.name}/${p.modelName}  OK  ${Date.now() - t0}ms  "${text}"`);
        } catch (e) {
            failures++;
            const cls = llm.classifyError(e);
            console.log(`[llm-smoke] ${p.name}/${p.modelName}  FAIL  ${Date.now() - t0}ms  kind=${cls.kind} status=${e.status || "?"} ${String(e.message).slice(0, 120)}`);
        }
    }
    console.log(`[llm-smoke] ${enabled.length - failures}/${enabled.length} providers OK`);
    // Let keep-alive handles close before exiting (avoids a Windows handle assertion).
    setTimeout(() => process.exit(failures ? 1 : 0), 500).unref();
}

main().catch((e) => { console.error("[llm-smoke] fatal:", e.message); process.exit(1); });
