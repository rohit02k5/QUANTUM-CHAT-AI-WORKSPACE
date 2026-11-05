const mongoose = require("mongoose");

// Per-user daily web-search quota counter. One doc per user per UTC day;
// TTL expires docs shortly after midnight.
const webSearchQuotaSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    day: { type: String, required: true }, // "YYYY-MM-DD" (UTC)
    count: { type: Number, default: 0 },
    expires: { type: Date, required: true },
});

webSearchQuotaSchema.index({ user: 1, day: 1 }, { unique: true });
webSearchQuotaSchema.index({ expires: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("WebSearchQuota", webSearchQuotaSchema);
