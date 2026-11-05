const mongoose = require("mongoose");

// Public API keys (Phase 5.4). The plaintext key is NEVER stored — only the
// SHA-256 hash + a display prefix. Lookup is by hash with timing-safe
// comparison at the caller.
const apiKeySchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    hash: { type: String, required: true, unique: true }, // sha256 hex of full key
    prefix: { type: String, required: true },             // first 8 chars for display
    lastUsedAt: { type: Date },
    revokedAt: { type: Date },
    createdAt: { type: Date, default: Date.now },
});

apiKeySchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("ApiKey", apiKeySchema);
