const mongoose = require("mongoose");

// LLM-rerank result cache (Phase 4.3). Keyed sha256(userId|query|candidateIds);
// 1h TTL — reranks are a latency optimization, not durable data.
const rerankCacheSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    key: { type: String, required: true },
    order: { type: [Number], required: true },
    createdAt: { type: Date, default: Date.now, expires: 3600 },
});

rerankCacheSchema.index({ user: 1, key: 1 }, { unique: true });

module.exports = mongoose.model("RerankCache", rerankCacheSchema);
