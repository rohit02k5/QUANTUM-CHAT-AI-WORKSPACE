const mongoose = require("mongoose");

// Per-user daily AI-request counter (Phase 5.0d). One doc per user per UTC
// day; TTL expires docs shortly after midnight — same pattern as
// WebSearchQuota. Counts one REQUEST (a whole agent run is one), not model
// calls, so multi-step work can't drain the cap internally.
const dailyAiQuotaSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    day: { type: String, required: true }, // "YYYY-MM-DD" (UTC)
    count: { type: Number, default: 0 },
    expires: { type: Date, required: true },
});

dailyAiQuotaSchema.index({ user: 1, day: 1 }, { unique: true });
dailyAiQuotaSchema.index({ expires: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("DailyAiQuota", dailyAiQuotaSchema);
