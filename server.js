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

    require("./utils/geminiHelper")
        .verifyConfiguredModels()
        .then((r) => {
            if (r.missing?.length) logger.warn({ missing: r.missing }, "[Gemini] configured models unavailable on this key");
            else logger.info({ chat: r.chat, embedding: r.embedding }, "[Gemini] configured models verified");
        })
        .catch(() => {});

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

// Graceful shutdown: stop claiming new jobs and release in-flight claims so
// they resume after restart instead of going stale.
async function shutdown(signal) {
    logger.info({ signal }, "shutdown — releasing ingestion jobs");
    try {
        await require("./utils/jobRunner").stopRunner();
    } catch (e) { /* ignore */ }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
