/**
 * eval-retrieval.js — retrieval stress eval (Phase 4.1/4.2).
 *
 *   node scripts/eval-retrieval.js --memory [--mode vector|keyword|hybrid] [--rewrite|--live-rewrite] [--rerank]
 *
 * Ingests evals/fixtures-retrieval (40 self-written docs) under a throwaway
 * user, runs evals/golden/retrieval.json through the REAL retriever, and
 * reports hit@1/3/5 + MRR + p50 latency per category and overall.
 *
 * Modes (when available in utils/retriever):
 *   vector   — embeddings only (the pre-Phase-4 baseline)
 *   keyword  — Mongo text index only
 *   hybrid   — RRF fusion of both legs (the Phase-4.2 default candidate)
 * --rewrite runs follow-up cases on their gold `standaloneQuery` (the rewrite
 * ceiling — deterministic, no generate calls).
 * --live-rewrite runs the real maybeRewriteQuery() (costs generate calls).
 * --rerank enables the LLM rerank for this run (costs generate calls).
 *
 * Writes evals/reports/retrieval-<ts>.json and, with --baseline, overwrites
 * evals/retrieval-baseline.json.
 */
const fs = require("fs");
const path = require("path");
require("dotenv").config();
const mongoose = require("mongoose");

const USE_MEMORY = process.argv.includes("--memory");
const WRITE_BASELINE = process.argv.includes("--baseline");
const MODE = (process.argv.find((a) => a.startsWith("--mode=")) || "--mode=vector").split("=")[1];
const USE_REWRITE = process.argv.includes("--rewrite");
const LIVE_REWRITE = process.argv.includes("--live-rewrite");
const USE_RERANK = process.argv.includes("--rerank");
// Phase 5.0c: deterministic dev/test halves (evals/retrieval-split.json,
// seed 42) — tune on --split=dev, report --split=test. Default: all.
const SPLIT = (process.argv.find((a) => a.startsWith("--split=")) || "--split=all").split("=")[1];
if (process.env.EMBED_CACHE_DIR === undefined) {
    process.env.EMBED_CACHE_DIR = path.join(__dirname, "../evals/.embed-cache");
}

const FIXTURE_DIR = path.join(__dirname, "../evals/fixtures-retrieval");
const GOLD = path.join(__dirname, "../evals/golden/retrieval.json");
const BASELINE = path.join(__dirname, "../evals/retrieval-baseline.json");
const REPORT_DIR = path.join(__dirname, "../evals/reports");
const TOP_K = 5; // need ranks through 5 for hit@5

const percentile = (arr, p) => {
    if (!arr.length) return undefined;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

async function main() {
    let mongod;
    if (USE_MEMORY) {
        const { MongoMemoryServer } = require("mongodb-memory-server");
        mongod = await MongoMemoryServer.create();
        process.env.MONGO_URI = mongod.getUri("quantum-eval-retrieval");
        console.log("[retrieval-eval] in-memory MongoDB");
    }
    const uri = process.env.EVAL_MONGO_URI || process.env.MONGO_URI;
    if (!uri) { console.error("Set MONGO_URI or use --memory"); process.exit(1); }
    await mongoose.connect(uri, process.env.EVAL_MONGO_DB ? { dbName: process.env.EVAL_MONGO_DB } : {});

    const User = require("../models/userModel");
    const File = require("../models/File");
    const Chunk = require("../models/Chunk");
    const DataLoader = require("../utils/dataLoader");
    const { recursiveSplitChunks } = require("../utils/chunker");
    const retriever = require("../utils/retriever");
    const geminiHelper = require("../utils/geminiHelper");

    const evalUser = await User.findOneAndUpdate(
        { email: "retrieval-eval@quantum.local" },
        { $setOnInsert: { username: "retrieval-eval", email: "retrieval-eval@quantum.local", password: "x".repeat(20) } },
        { upsert: true, new: true }
    );
    const userId = evalUser._id;

    // --- ingest (idempotent; embedding cache makes reruns free) ---
    const fileMap = {};
    for (const fname of fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".txt")).sort()) {
        let fileDoc = await File.findOne({ user: userId, originalName: fname });
        if (!fileDoc) {
            const fpath = path.join(FIXTURE_DIR, fname);
            const { documents } = await DataLoader.load(fpath, "text/plain");
            fileDoc = await File.create({
                user: userId, filename: fname, originalName: fname, path: fpath,
                mimetype: "text/plain", status: "ready",
                content: documents.map((d) => d.pageContent).join("\n\n"),
            });
            const chunkDocs = recursiveSplitChunks(documents, { chunkSize: 1000, chunkOverlap: 200 });
            for (const cd of chunkDocs) {
                const embedding = await geminiHelper.getEmbedding(cd.pageContent, { task: "document" });
                await Chunk.create({
                    user: userId, file: fileDoc._id,
                    text: cd.pageContent, pageContent: cd.pageContent, metadata: cd.metadata,
                    type: "text", embedding, embeddingDims: embedding.length,
                    embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2",
                });
            }
            console.log(`[retrieval-eval] ingested ${fname} (${chunkDocs.length} chunks)`);
        }
        fileMap[fname] = fileDoc._id;
    }

    // --- resolve gold markers to (fileId, chunkId) ---
    let cases = JSON.parse(fs.readFileSync(GOLD, "utf8"));
    if (SPLIT !== "all") {
        const split = JSON.parse(fs.readFileSync(path.join(__dirname, "../evals/retrieval-split.json"), "utf8"));
        const ids = new Set(split[SPLIT] || []);
        cases = cases.filter((c) => ids.has(c.id));
        console.log(`[retrieval-eval] split=${SPLIT} — ${cases.length} cases`);
    }
    for (const c of cases) {
        c.goldRefs = [];
        for (const g of c.gold) {
            const fid = fileMap[g.f];
            if (!fid) throw new Error(`gold file ${g.f} not ingested`);
            const chunk = await Chunk.findOne({ file: fid, text: new RegExp(g.m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }).select("_id");
            c.goldRefs.push({ fileId: fid.toString(), chunkId: chunk?._id?.toString(), marker: g.m });
        }
    }

    // --- run ---
    if (MODE !== "vector") {
        await retriever.ensureTextIndex();
    }
    if (LIVE_REWRITE) process.env.RAG_REWRITE = "true";
    const retrieve = retriever.retrieveChunks;
    const results = [];
    const startCalls = { ...geminiHelper.calls };
    for (const c of cases) {
        let query = USE_REWRITE && c.standaloneQuery ? c.standaloneQuery : c.query;
        if (LIVE_REWRITE && c.history?.length) {
            const rw = await require("../utils/queryRewrite").maybeRewriteQuery(c.query, c.history).catch(() => ({ query: c.query }));
            query = rw.query;
        }
        const t0 = Date.now();
        const chunks = await retrieve(userId, query, TOP_K, [], { mode: MODE, rerank: USE_RERANK }).catch((e) => {
            console.warn(`  retrieve failed for ${c.id}: ${e.message}`);
            return [];
        });
        const ms = Date.now() - t0;
        // Best rank across any gold chunk (chunk-id match first, file fallback)
        let rank = -1;
        for (let i = 0; i < chunks.length; i++) {
            const ch = chunks[i];
            const hit = c.goldRefs.some((g) =>
                (g.chunkId && ch._id?.toString() === g.chunkId) ||
                ch.fileId?.toString() === g.fileId || ch.file?.toString() === g.fileId
            );
            if (hit) { rank = i; break; }
        }
        results.push({ id: c.id, category: c.category, rank, ms, topFile: chunks[0]?.fileId?.toString() });
    }

    const cats = [...new Set(cases.map((c) => c.category))];
    const summarize = (rows) => {
        const lats = rows.map((r) => r.ms);
        return {
            n: rows.length,
            hitAt1: +(rows.filter((r) => r.rank === 0).length / rows.length).toFixed(4),
            hitAt3: +(rows.filter((r) => r.rank >= 0 && r.rank < 3).length / rows.length).toFixed(4),
            hitAt5: +(rows.filter((r) => r.rank >= 0 && r.rank < 5).length / rows.length).toFixed(4),
            mrr: +(rows.reduce((s, r) => s + (r.rank >= 0 ? 1 / (r.rank + 1) : 0), 0) / rows.length).toFixed(4),
            p50LatencyMs: percentile(lats, 50),
        };
    };

    const perCategory = {};
    for (const cat of cats) perCategory[cat] = summarize(results.filter((r) => r.category === cat));
    const overall = summarize(results);
    const calls = {
        embed: geminiHelper.calls.embed - (startCalls.embed || 0),
        embedCached: geminiHelper.calls.embedCached - (startCalls.embedCached || 0),
        generate: geminiHelper.calls.generate - (startCalls.generate || 0),
    };

    const out = {
        timestamp: new Date().toISOString(),
        mode: MODE,
        split: SPLIT,
        rewrite: USE_REWRITE ? "gold" : LIVE_REWRITE ? "live" : false,
        rerank: USE_RERANK,
        config: {
            topK: TOP_K,
            candidates: parseInt(process.env.RAG_CANDIDATES || "20", 10),
            rrfK: parseInt(process.env.RAG_RRF_K || "60", 10),
            minScore: parseFloat(process.env.RAG_MIN_SCORE || "0.5"),
        },
        perCategory, overall, calls,
        details: results,
    };
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const ts = out.timestamp.replace(/[:.]/g, "-");
    const fp = path.join(REPORT_DIR, `retrieval-${ts}.json`);
    fs.writeFileSync(fp, JSON.stringify(out, null, 2));
    if (WRITE_BASELINE) fs.writeFileSync(BASELINE, JSON.stringify(out, null, 2) + "\n");

    console.table(Object.fromEntries([["overall", overall], ...Object.entries(perCategory)]));
    console.log(`calls: embed ${calls.embed} (+${calls.embedCached} cached), generate ${calls.generate}`);
    console.log(`report: ${path.relative(process.cwd(), fp)}`);

    // cleanup throwaway data unless --keep
    if (!process.argv.includes("--keep")) {
        await Chunk.deleteMany({ user: userId });
        await File.deleteMany({ user: userId });
        await mongoose.connection.collection("ingestionjobs").deleteMany({ user: userId }).catch(() => {});
        await User.deleteOne({ _id: userId });
    }
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
}

main().catch((e) => { console.error("[retrieval-eval] fatal:", e); process.exit(1); });
