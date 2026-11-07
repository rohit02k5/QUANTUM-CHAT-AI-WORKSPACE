const mongoose = require("mongoose");
const geminiHelper = require("../utils/geminiHelper");
const { VECTOR_INDEX } = require("../utils/retriever");
const pkg = require("../package.json");

// Unauthenticated health/status endpoint — safe, no secrets.
exports.health = async (req, res) => {
    const dbOk = mongoose.connection.readyState === 1;
    const status = {
        status: dbOk ? "ok" : "degraded",
        uptimeSec: Math.round(process.uptime()),
        version: pkg.version,
        db: { ok: dbOk, latencyMs: null },
        vectorIndex: { name: VECTOR_INDEX, exists: null, status: "unchecked" },
        models: {
            chat: process.env.GEMINI_MODEL || "gemini-2.5-flash",
            embedding: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2",
            embeddingDims: geminiHelper.EMBEDDING_DIMS,
        },
        // Phase 6: provider readiness — names, states, models, error codes.
        // Never keys, URLs, or request content.
        providers: require("../utils/llm").providerStatus(),
    };

    if (dbOk) {
        const t = Date.now();
        try {
            await mongoose.connection.db.admin().ping();
            status.db.latencyMs = Date.now() - t;
        } catch (e) {
            status.db.ok = false;
            status.db.latencyMs = Date.now() - t;
        }
        // Best-effort index check — never fails the health call
        try {
            const indexes = await mongoose.connection.collection("chunks").listSearchIndexes().toArray();
            status.vectorIndex.exists = indexes.some((i) => i.name === VECTOR_INDEX);
            status.vectorIndex.status = status.vectorIndex.exists ? "ready" : "missing";
        } catch (e) {
            status.vectorIndex.status = "unsupported";
        }
    }

    res.status(status.db.ok ? 200 : 503).json(status);
};
