const dotenv = require("dotenv");
dotenv.config();
const colors = require("colors");
const mongoose = require("mongoose");
const connectDB = require("./config/db");
const logger = require("./utils/logger");

// Validate critical env vars
const REQUIRED_ENV = ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "JWT_ACCESS_EXPIREIN", "JWT_REFRESH_EXPIREIN", "MONGO_URI"];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`FATAL ERROR: missing env vars: ${missing.join(", ")}`.red.bold);
  process.exit(1);
}

const app = require("./app");

connectDB();

// Once DB is up: ensure the Atlas vector-search index exists (best-effort),
// verify configured Gemini models exist, and sweep stale temp uploads.
mongoose.connection.once("open", async () => {
    const { VECTOR_INDEX } = require("./utils/retriever");
    const dims = require("./utils/geminiHelper").EMBEDDING_DIMS;
    // SKIP_INDEX_ENSURE: for throwaway/verification databases where creating
    // an Atlas Search index would consume the cluster's index slots.
    if (process.env.SKIP_INDEX_ENSURE === "1") {
        logger.info("[RAG] index ensure skipped (SKIP_INDEX_ENSURE=1)");
    } else
    try {
        // createSearchIndex requires the collection to exist on Atlas
        const cols = await mongoose.connection.db.listCollections({ name: "chunks" }).toArray();
        if (!cols.length) await mongoose.connection.db.createCollection("chunks");
        await mongoose.connection.collection("chunks").createSearchIndex({
            name: VECTOR_INDEX,
            type: "vectorSearch",
            definition: {
                fields: [
                    { type: "vector", path: "embedding", numDimensions: dims, similarity: "cosine" },
                    { type: "filter", path: "user" },
                    { type: "filter", path: "file" },
                    { type: "filter", path: "embeddingDims" },
                ],
            },
        });
        logger.info(`[RAG] Vector search index '${VECTOR_INDEX}' ensured (dims=${dims})`);
    } catch (err) {
        logger.warn(`[RAG] Could not ensure vector index '${VECTOR_INDEX}' (may already exist): ${err.message}`);
    }

    // Keyword leg (Phase 4.2): regular Mongo text index, compound
    // {user:1, text:"text"} — user equality prefix keeps $text queries
    // owner-scoped. Drops any conflicting single-field text index first.
    try {
        const name = await require("./utils/retriever").ensureTextIndex();
        logger.info(`[RAG] keyword text index '${name}' ensured`);
    } catch (err) {
        logger.warn(`[RAG] could not ensure keyword text index: ${err.message}`);
    }

    require("./utils/llm")
        .bootValidate()
        .then(({ warnings, gemini }) => {
            for (const w of warnings || []) logger.warn(w, "[llm] chain validation");
            if (gemini?.missing?.length) logger.warn({ missing: gemini.missing }, "[Gemini] configured models unavailable on this key");
            else if (gemini) logger.info({ chat: gemini.chat, embedding: gemini.embedding }, "[Gemini] configured models verified");
        })
        .catch((e) => logger.warn({ err: e.message }, "[llm] boot validation failed"));

    require("./controllers/fileController").cleanupTempFiles();

    // Ingestion runner: requeue crashed jobs, then start polling for queued work
    const jobRunner = require("./utils/jobRunner");
    jobRunner.requeueStale()
        .then((n) => { if (n) logger.info({ requeued: n }, "[Jobs] requeued stale ingestion jobs"); })
        .catch((e) => logger.warn({ err: e.message }, "[Jobs] stale requeue failed"))
        .finally(() => jobRunner.startRunner());
});

const PORT = process.env.PORT || 8080;
const server = app.listen(PORT, () => {
  console.log(`Server Running in ${process.env.DEV_MODE} on ${PORT}`.bgCyan.white);
});

// Graceful shutdown: end open SSE streams cleanly, stop claiming new jobs
// and release in-flight claims so they resume after restart, close the DB.
async function shutdown(signal) {
    logger.info({ signal }, "shutdown — closing SSE streams, releasing ingestion jobs");
    try {
        require("./utils/sseRegistry").closeAll();
    } catch (e) { /* ignore */ }
    try {
        await require("./utils/jobRunner").stopRunner();
    } catch (e) { /* ignore */ }
    server.close(async () => {
        try { await mongoose.disconnect(); } catch (e) { /* ignore */ }
        process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
