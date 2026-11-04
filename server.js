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
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server Running in ${process.env.DEV_MODE} on ${PORT}`.bgCyan.white);
});
