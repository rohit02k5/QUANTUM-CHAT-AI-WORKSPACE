/**
 * gen-demo-seed.js — Phase 6.4 demo snapshot generator (run ONCE, needs quota).
 *
 *   node scripts/gen-demo-seed.js
 *
 * Embeds the self-written demo corpus with the live embedding model and writes
 * scripts/demo-seed.snapshot.json. The committed snapshot lets
 * scripts/seed-demo.js reseed the demo account with ZERO AI calls.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { getEmbedding } = require("../utils/geminiHelper");

// ---- Self-written demo corpus (no copyrighted material) -------------------
const DOCS = [
    {
        originalName: "platform-reliability-report.txt",
        mimetype: "text/plain",
        content: `Q3 Platform Reliability Report

Executive summary. Uptime for the quarter was 99.72%, up from 99.51% in Q2.
Three SEV-2 incidents occurred, all in the cache coherency subsystem; none
resulted in data loss. Median API latency improved from 240ms to 198ms after
the connection-pool changes shipped in week 6.

Incident ERR-8821-C accounted for 41% of error-budget consumption. The fix
(clock-skew guard in the lease manager) shipped in v3.7.20-rc.1 and post-deploy
metrics show read skew back under 0.1%.

Capacity notes. The database tier reached 71% of its storage budget; the
migration plan targets a dedicated instance next quarter. Ingestion throughput
peaked at 310 documents/minute during the October backfill without queuing.

Recommendations. Add a second read replica before the holiday freeze, and
complete the runbook automation for lease-manager failover.`,
    },
    {
        originalName: "remote-work-security-policy.txt",
        mimetype: "text/plain",
        content: `Remote Work and Security Policy (internal, v2.3)

Scope. This policy applies to all employees and contractors who access company
systems from outside the primary office network.

Device requirements. All devices must run a supported OS with automatic
updates enabled, full-disk encryption, and a screen lock of at most 5 minutes.
Personal devices may only access email and calendar through the managed
container app.

Access rules. Production systems require VPN plus hardware-backed MFA.
Shared credentials are prohibited; every engineer receives individual,
least-privilege accounts. API keys must be stored in the team vault, never in
repositories or chat.

Incident reporting. Suspected compromise must be reported to security within
one hour of discovery using the on-call channel, even if it later proves to be
a false alarm.`,
    },
    {
        originalName: "platform-sync-transcript.txt",
        mimetype: "text/plain",
        content: `Platform Sync — Meeting Transcript (2026-10-28)

[00:12] Priya: Good morning. Quick agenda — the ERR-8821-C postmortem, then
the storage migration, then demo prep for Friday.

[02:45] Marcus: On the postmortem — the clock-skew guard shipped in
v3.7.20-rc.1 yesterday. Read skew is back under 0.1% on west-2, so I'm closing
the action item.

[07:30] Priya: Nice. What about the two-replica lease test that was flagged?

[08:15] Marcus: Still open. I paired with Dev on it — the test passes on
memory mongo but we need an Atlas run before we sign off.

[12:40] Priya: Storage migration. We're at 71% on the shared tier. Options are
a dedicated instance or pruning the archive collection.

[15:02] Dev: Dedicated instance is the right call — pruning buys us maybe six
weeks, migration solves it for the year. I'll draft the plan by Thursday.

[19:48] Priya: Agreed. Last item: Friday's demo. We'll use the recorded replay
as the fallback path if the provider quota is exhausted again.

[21:20] Marcus: Smart. I'll record the agent run tonight while quota is fresh.`,
    },
    {
        originalName: "incident-metrics.csv",
        mimetype: "text/csv",
        content: `month,sev1,sev2,sev3,error_budget_consumed_pct,median_latency_ms
2026-07,0,1,4,38,240
2026-08,0,1,3,31,215
2026-09,0,1,2,41,198
2026-10,0,0,3,22,186`,
    },
    {
        originalName: "ops-runbook.txt",
        mimetype: "text/plain",
        content: `Operations Runbook — Lease Manager Failover

Trigger conditions. Fail over the lease manager when lease renewals fail for
more than 60 seconds, or when CLOCK_SKEW_GUARD trips on three consecutive
heartbeats.

Procedure. 1) Freeze writes with WRITE_FREEZE=on at the coordinator. 2) Confirm
the standby's lease table is within one epoch (SHOW LEASE_EPOCH on both
nodes). 3) Promote the standby and wait for the first barrier release.
4) Unfreeze writes and verify read skew is under 0.5% for two minutes.

Rollback. If skew exceeds 1% during promotion, demote immediately and run
COH-ROLL-8821. Never promote a standby more than two epochs behind.`,
    },
];

const MEMORIES = [
    "User prefers concise answers with bullet points for status updates.",
    "User's team works on the Meridian platform (cache coherency, lease manager, ingestion).",
    "User reviews incident postmortems on Fridays.",
];

const DECK = {
    name: "Platform Concepts",
    cards: [
        { front: "What is the lease manager's clock-skew guard?", back: "A check that blocks lease renewal when node clocks drift beyond the guard threshold (CLOCK_SKEW_GUARD_MS)." },
        { front: "What does COH-ROLL-8821 do?", back: "Rollback marker for incident ERR-8821-C — demotes a promoted standby when read skew exceeds 1% during promotion." },
        { front: "When is WRITE_FREEZE used during failover?", back: "Step 1 of lease-manager failover — freeze writes before promoting the standby." },
        { front: "What was Q3 uptime?", back: "99.72%, up from 99.51% in Q2." },
        { front: "What consumed the most error budget in Q3?", back: "Incident ERR-8821-C — 41% of the quarter's budget." },
        { front: "How many epochs behind can a standby be for promotion?", back: "At most two epochs; never promote a standby more than two behind." },
    ],
};

const CHATS = [
    {
        title: "ERR-8821-C postmortem",
        messages: [
            { role: "user", content: "What caused the ERR-8821-C incident?" },
            { role: "model", content: "A clock-skew regression in the lease manager let a follower renew a read lease after the leader had already granted a write lease for the same page. The guard shipped in v3.7.20-rc.1 and read skew is now back under 0.1%. [platform-sync-transcript.txt 02:45]", provider: "gemini", model: "gemini-2.5-flash" },
        ],
    },
];

const OUT = path.join(__dirname, "demo-seed.snapshot.json");

async function main() {
    if (process.env.GEMINI_MOCK === "1") {
        console.error("Refusing to generate a snapshot from mock embeddings — run without GEMINI_MOCK.");
        process.exit(1);
    }
    const model = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2";
    const dims = parseInt(process.env.EMBEDDING_DIMS || "768", 10);

    const files = [];
    for (const doc of DOCS) {
        const paragraphs = doc.content.split(/\n\n+/).filter((p) => p.trim());
        const chunks = [];
        for (const text of paragraphs) {
            const embedding = await getEmbedding(text, { task: "document" });
            if (embedding.length !== dims) throw new Error(`dims mismatch ${embedding.length} != ${dims}`);
            chunks.push({ text, embedding });
        }
        files.push({ originalName: doc.originalName, mimetype: doc.mimetype, content: doc.content, chunks });
        console.log(`[gen-demo-seed] ${doc.originalName}: ${chunks.length} chunks embedded`);
    }

    const memories = [];
    for (const text of MEMORIES) {
        memories.push({ text, embedding: await getEmbedding(text, { task: "document" }) });
    }

    const snapshot = {
        meta: {
            generatedAt: new Date().toISOString(),
            embeddingModel: model,
            embeddingDims: dims,
            note: "Self-written demo corpus. Embeddings were generated ONCE by scripts/gen-demo-seed.js; seeding from this file costs zero AI calls.",
        },
        files,
        memories,
        deck: DECK,
        chats: CHATS,
    };
    fs.writeFileSync(OUT, JSON.stringify(snapshot, null, 1));
    const kb = Math.round(fs.statSync(OUT).size / 1024);
    console.log(`[gen-demo-seed] wrote ${OUT} (${kb} KB, ${files.reduce((n, f) => n + f.chunks.length, 0)} chunks, ${memories.length} memories)`);
}

main().catch((e) => { console.error("[gen-demo-seed] fatal:", e.message); process.exit(1); });
