const mongoose = require("mongoose");

const usageEventSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    kind: {
        type: String,
        enum: ["chat", "agent", "embed", "transcribe", "vision", "judge", "tool"],
        required: true,
    },
    model: { type: String },
    promptTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    latencyMs: { type: Number, default: 0 },
    ok: { type: Boolean, default: true },
    errorCode: { type: String },
    requestId: { type: String },
    createdAt: { type: Date, default: Date.now, expires: 90 * 24 * 60 * 60 }, // TTL: 90 days
});

usageEventSchema.index({ user: 1, createdAt: -1 });
usageEventSchema.index({ kind: 1, createdAt: -1 });

module.exports = mongoose.model("UsageEvent", usageEventSchema);
