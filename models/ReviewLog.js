const mongoose = require("mongoose");

// One row per review event — the audit trail behind SM-2 scheduling and
// the stats endpoint (streaks, retention). TTL: logs expire after 1 year.
const reviewLogSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    card: { type: mongoose.Schema.Types.ObjectId, ref: "Card", required: true },
    deck: { type: mongoose.Schema.Types.ObjectId, ref: "Deck", required: true },
    grade: { type: Number, required: true, min: 0, max: 5 },
    prevIntervalDays: { type: Number, required: true },
    newIntervalDays: { type: Number, required: true },
    prevEase: { type: Number, required: true },
    newEase: { type: Number, required: true },
    reviewedAt: { type: Date, default: Date.now },
});

reviewLogSchema.index({ user: 1, reviewedAt: -1 });
reviewLogSchema.index({ reviewedAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

module.exports = mongoose.model("ReviewLog", reviewLogSchema);
