const mongoose = require("mongoose");

/**
 * Per-user embedding reuse (Phase 6B): skip re-embedding text a user has
 * already embedded under the active profile. Scoped per user so entries
 * never cross tenants; TTL + per-user cap keep it within the M0 budget.
 * Registered in the account-deletion cascade.
 */
const embeddingCacheSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    hash: { type: String, required: true }, // sha256(text|model|dims|taskType)
    vector: { type: [Number], required: true },
    model: { type: String, required: true },
    dims: { type: Number, required: true },
    taskType: { type: String, default: "document" },
    createdAt: { type: Date, default: Date.now, expires: 7 * 24 * 60 * 60 }, // TTL 7 days
});

embeddingCacheSchema.index({ user: 1, hash: 1 }, { unique: true });

module.exports = mongoose.model("EmbeddingCache", embeddingCacheSchema);
