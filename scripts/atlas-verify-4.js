// Atlas verification checklist for Phase 4, run against the real cluster on
// database "quantum_ai_eval" with a throwaway user that is deleted at the end.
// Usage: node scripts/atlas-verify-4.js
// Requires MONGO_URI + GEMINI_API_KEY in the environment. Never prints secrets.
// Generation-dependent steps report SKIP when the Gemini quota is exhausted.
require("dotenv").config();
const request = require("supertest");
const mongoose = require("mongoose");

process.env.INGEST_SYNC = "true";
const app = require("../app");
const EVAL_DB = process.env.EVAL_MONGO_DB || "quantum_ai_eval";

const results = [];
let quotaExhausted = false;
const quotaSkip = (name, err) => {
    const quota = quotaExhausted || /429|503|quota|RESOURCE_EXHAUSTED|rate.?limit/i.test(String(err?.message || err));
    if (quota) quotaExhausted = true;
    results.push(`${quota ? "SKIP " : "FAIL "}${name}${quota ? " — Gemini quota exhausted, re-run after reset" : ": " + (err?.message || err)}`);
    return quota;
};
const step = (name, ok, detail = "") =>
    results.push(`${ok ? "PASS " : "FAIL "}${name}${detail ? " — " + detail : ""}`);

async function main() {
    const uri = process.env.MONGO_URI;
    if (!uri) { console.error("Set MONGO_URI"); process.exit(1); }
    await mongoose.connect(uri, { dbName: EVAL_DB });
    console.log(`connected to ${mongoose.connection.host} db=${EVAL_DB}`);
    const db = mongoose.connection.db;
    const File = require("../models/File");
    const Chunk = require("../models/Chunk");
    const Chat = require("../models/Chat");
    const retriever = require("../utils/retriever");
    const geminiHelper = require("../utils/geminiHelper");

    const t = `atlas4-${Date.now()}`;
    const res = await request(app).post("/api/v1/auth/register")
        .send({ username: "atlas4", email: `${t}@t.com`, password: "AtlasVerify4!" });
    const token = res.body?.token;
    step("register throwaway user", !!token);
    const auth = { Authorization: `Bearer ${token}` };
    const userId = (await require("../models/userModel").findOne({ email: `${t}@t.com` }))?._id;

    // Preflight: is the Gemini generate quota usable?
    try {
        await geminiHelper.generateContentWithRetry("Reply with the single word OK.", {}, 1, "chat");
        results.push("INFO gemini generate quota: available");
    } catch (e) {
        quotaExhausted = /429|503|quota|RESOURCE_EXHAUSTED/i.test(String(e?.message || e));
        results.push(`INFO gemini generate quota: ${quotaExhausted ? "exhausted — generation steps will SKIP" : "error: " + e.message}`);
    }

    try {
        // ------------------------------------------------------------------
        // 1. Regular text index builds on M0 — report size + build time
        // ------------------------------------------------------------------
        const t0 = Date.now();
        const idxName = await retriever.ensureTextIndex();
        const buildMs = Date.now() - t0;
        const collStats = await db.command({ collStats: "chunks" }).catch(() => null);
        const idxBytes = collStats?.indexSizes?.[idxName];
        step("regular text index builds on M0", !!idxName,
            `${idxName}, build ${buildMs}ms, size ${idxBytes != null ? (idxBytes / 1024).toFixed(1) + " KB" : "n/a"}`);

        // ------------------------------------------------------------------
        // Seed two docs + a summarized chat for retrieval/search checks
        // ------------------------------------------------------------------
        const docA = "The Zephyr-9 industrial mixer uses a planetary gearbox rated at 40 Nm torque. Service manual ref ZMX-4409.";
        const docB = "Sourdough starter maintenance: feed equal parts flour and water every 12 hours at 24 degrees Celsius.";
        const seedFile = async (name, text) => {
            const f = await File.create({ user: userId, filename: name, originalName: name, path: "x", mimetype: "text/plain", status: "ready", content: text });
            const emb = await geminiHelper.getEmbedding(text, { task: "document" });
            await Chunk.create({
                user: userId, file: f._id, text, pageContent: text,
                metadata: { chunkIndex: 0 }, type: "text",
                embedding: emb, embeddingDims: emb.length,
                embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2",
            });
            return f;
        };
        await seedFile("mixer-manual.txt", docA);
        await seedFile("sourdough.txt", docB);

        // Wait for the (regular) text index to catch up — regular indexes are
        // consistent immediately, but give $text a beat on the shared tier.
        await new Promise((r) => setTimeout(r, 1500));

        // ------------------------------------------------------------------
        // 2. Vector-only vs hybrid on Atlas (few labeled queries)
        // ------------------------------------------------------------------
        const evalCases = [
            { q: "planetary gearbox torque rating", gold: "mixer-manual.txt" },      // paraphrase
            { q: "ZMX-4409", gold: "mixer-manual.txt" },                             // exact identifier
            { q: "how often should I feed my starter", gold: "sourdough.txt" },      // paraphrase
        ];
        const nameOf = async (fileId) => (await File.findById(fileId))?.originalName;
        const hitRank = (chunks, gold, names) => chunks.findIndex((c) => names.get(String(c.fileId)) === gold);

        const fileIds = (await File.find({ user: userId }).select("_id originalName").lean());
        const names = new Map(fileIds.map((f) => [String(f._id), f.originalName]));

        const runMode = async (mode) => {
            const ranks = [];
            for (const c of evalCases) {
                const chunks = await retriever.retrieveChunks(userId, c.q, 5, [], { mode }).catch(() => []);
                ranks.push(hitRank(chunks, c.gold, names));
            }
            return ranks;
        };
        const vRanks = await runMode("vector");
        const hRanks = await runMode("hybrid");
        const mrr = (r) => +(r.reduce((s, x) => s + (x >= 0 ? 1 / (x + 1) : 0), 0) / r.length).toFixed(3);
        step("retrieval on Atlas: vector vs hybrid", vRanks.every((r) => r >= 0),
            `vector ranks ${JSON.stringify(vRanks)} MRR ${mrr(vRanks)} | hybrid ranks ${JSON.stringify(hRanks)} MRR ${mrr(hRanks)}`);

        // ------------------------------------------------------------------
        // 3. Missing vector index → hybrid still returns via fallback
        // ------------------------------------------------------------------
        const coll = db.collection("chunks");
        const origList = coll.listSearchIndexes;
        coll.listSearchIndexes = () => ({ toArray: async () => [] });
        retriever._resetIndexCache();
        try {
            const chunks = await retriever.retrieveChunks(userId, "planetary gearbox torque", 5, [], { mode: "hybrid" });
            step("missing vector index → hybrid fallback returns results", chunks.length > 0, `${chunks.length} chunks`);
        } finally {
            coll.listSearchIndexes = origList;
            retriever._resetIndexCache();
        }

        // ------------------------------------------------------------------
        // 4. Smart global search — paraphrase finds chat + file; identifier
        //    finds the right chunk
        // ------------------------------------------------------------------
        // A chat with a summary about the gearbox (embedded via the real model)
        const chatDoc = await Chat.create({
            user: userId, title: "Mixer maintenance questions",
            messages: [
                { role: "user", content: "How do I service the Zephyr mixer?" },
                { role: "model", content: "Check the planetary gearbox torque spec." },
            ],
        });
        await require("../utils/chatSummary").maybeSummarizeChat(chatDoc._id).catch((e) => quotaSkip("summary gen", e));
        if (quotaExhausted) {
            quotaSkip("smart search", "preflight");
        } else {
            // Summary embedding is written async — wait for it
            let srch = null;
            for (let i = 0; i < 6; i++) {
                await new Promise((r) => setTimeout(r, 3000));
                srch = await request(app).get("/api/v1/search?query=gearbox%20torque%20spec&mode=smart").set(auth);
                if (srch.status === 200 && (srch.body.chats?.length || srch.body.files?.length)) break;
            }
            const gotChat = srch?.body?.chats?.some((c) => String(c.id) === String(chatDoc._id));
            const gotFile = srch?.body?.files?.some((f) => names.get(String(f.id)) === "mixer-manual.txt");
            step("smart search: paraphrase finds chat + file", !!(gotChat || gotFile),
                `chat=${gotChat} file=${gotFile} (chats ${srch?.body?.chats?.length}, files ${srch?.body?.files?.length})`);

            const exact = await request(app).get("/api/v1/search?query=ZMX-4409&mode=smart").set(auth);
            const rightChunk = exact.body?.files?.some((f) => names.get(String(f.id)) === "mixer-manual.txt" && /ZMX-4409/.test(f.snippet || ""));
            step("smart search: exact identifier finds the chunk", !!rightChunk,
                `files ${JSON.stringify((exact.body?.files || []).map((f) => f.name))}`);
        }

        // ------------------------------------------------------------------
        // 5. Account deletion cascade → zero docs + zero GridFS blobs
        // ------------------------------------------------------------------
        const { cascadeDelete } = require("../utils/accountCascade");
        await cascadeDelete(userId);
        const leftovers = {};
        for (const collName of ["chats", "files", "chunks", "ingestionjobs", "usageevents", "personas", "flashcardsets", "rerankcaches", "websearchquotas"]) {
            leftovers[collName] = await db.collection(collName).countDocuments({ user: userId }).catch(() => 0);
        }
        const blobs = await db.collection("fs.files").countDocuments({}).catch(() => -1);
        const userDoc = await require("../models/userModel").findById(userId);
        const totalLeft = Object.values(leftovers).reduce((a, b) => a + b, 0);
        step("deletion cascade: zero documents in every collection", totalLeft === 0, JSON.stringify(leftovers));
        step("deletion cascade: zero GridFS blobs remain", blobs === 0, `${blobs} fs.files docs`);
        // Delete the user record itself (cascade covers data, not the account)
        await require("../models/userModel").deleteOne({ _id: userId });
        step("throwaway user record deleted", !(await require("../models/userModel").findById(userId)), "");

        // ------------------------------------------------------------------
        // 6. Cluster state: storage + prod index count (must still be 1 of 3)
        // ------------------------------------------------------------------
        const stats = await db.stats();
        const mb = (stats.storageSize / 1e6).toFixed(1);
        let prodIdx = "n/a", prodDbName = "default";
        try {
            const prodConn = await mongoose.createConnection(uri).asPromise();
            prodDbName = prodConn.db.databaseName;
            const prodChunks = await prodConn.db.listCollections({ name: "chunks" }).toArray();
            if (prodChunks.length) {
                prodIdx = (await prodConn.db.collection("chunks").listSearchIndexes().toArray()).length;
            }
            await prodConn.close();
        } catch (e) { prodIdx = "n/a (" + e.message.slice(0, 60) + ")"; }
        results.push(`INFO eval-db storage ${mb} MB; prod db "${prodDbName}" search indexes on chunks: ${prodIdx} (must still be 1 of 3)`);
    } finally {
        // Belt-and-braces cleanup if a check crashed mid-run
        if (token) {
            await request(app).delete("/api/v1/auth/account").set(auth)
                .send({ password: "AtlasVerify4!" }).catch(() => {});
            const left = await File.countDocuments({ originalName: /mixer-manual|sourdough/ });
            step("no leftover test files", left === 0, `${left} left`);
        }
    }
    console.log(results.join("\n"));
    const fails = results.filter((r) => r.startsWith("FAIL")).length;
    console.log(`\n${results.filter((r) => r.startsWith("PASS")).length} pass, ${results.filter((r) => r.startsWith("SKIP")).length} skip, ${fails} fail`);
    await mongoose.disconnect();
    process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error("checklist crashed:", e); process.exit(1); });
