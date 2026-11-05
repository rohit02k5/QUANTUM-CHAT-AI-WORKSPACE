/**
 * record-demo.js — Phase 6.4 replay recorder (needs live provider quota +
 * a running server + a seeded demo account).
 *
 *   BASE=http://localhost:8080 node scripts/record-demo.js [scenarioId ...]
 *
 * Authenticates as the demo user, POSTs each scenario's prompt to the real
 * /chat/new/stream endpoint, and records the SSE events into
 * scripts/demo-replays.json — replacing the hand-authored events for those
 * scenarios while keeping the same file shape.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const BASE = (process.env.BASE || "http://localhost:8080").replace(/\/$/, "");
const REPLAYS = path.join(__dirname, "demo-replays.json");

async function main() {
    const wanted = process.argv.slice(2);
    const data = JSON.parse(fs.readFileSync(REPLAYS, "utf8"));
    const scenarios = data.scenarios.filter((s) => !wanted.length || wanted.includes(s.id));
    if (!scenarios.length) { console.error("no matching scenarios"); process.exit(1); }

    const login = await fetch(`${BASE}/api/v1/auth/demo`, { method: "POST" });
    if (!login.ok) { console.error("demo login failed:", login.status, await login.text()); process.exit(1); }
    const { token } = await login.json();

    for (const s of scenarios) {
        console.log(`[record-demo] recording ${s.id}: "${s.prompt}"`);
        const res = await fetch(`${BASE}/api/v1/chat/new/stream`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ message: s.prompt, mode: s.id === "agent-trace" ? "agent" : undefined }),
        });
        if (!res.ok || !res.body) { console.error(`  stream failed: ${res.status}`); continue; }
        const text = await res.text();
        const events = text.split("\n\n").filter((b) => b.startsWith("data:"))
            .map((b) => JSON.parse(b.slice(5).trim()))
            // Rewrite concrete ids into portable replay fields: citation
            // sources keep fileKey (originalName) so replay can re-resolve.
            .map((e) => {
                if (e.type === "meta" && Array.isArray(e.sources)) {
                    return { ...e, chatId: undefined, requestId: undefined, sources: e.sources.map((src) => ({ fileKey: src.originalName, ...src })) };
                }
                return e;
            });
        if (!events.some((e) => e.type === "done")) { console.error("  no done event — keeping existing recording"); continue; }
        s.events = events;
        console.log(`  recorded ${events.length} events`);
    }
    data._meta = { ...(data._meta || {}), recordedAt: new Date().toISOString(), recordedProvider: "live", note: "Live-recorded via scripts/record-demo.js against the real stream endpoint." };
    fs.writeFileSync(REPLAYS, JSON.stringify(data, null, 4) + "\n");
    console.log("[record-demo] wrote", REPLAYS);
}

main().catch((e) => { console.error("[record-demo] fatal:", e.message); process.exit(1); });
