const mongoose = require("mongoose");

// Long-term user memory (Phase 5.1). Extracted ONLY from user-authored
// message text — never from documents, tool results, or assistant output —
// so a poisoned document can't inject memories. Sensitive content is
// filtered twice: by the extraction prompt and by a server-side denylist.
const memorySchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, required: true, maxlength: 300 },
    category: {
        type: String,
        enum: ["preference", "fact", "goal", "project"],
        default: "fact",
    },
    embedding: { type: [Number], default: undefined },
    embeddingModel: { type: String },
    embeddingDims: { type: Number },
    sourceChat: { type: mongoose.Schema.Types.ObjectId, ref: "Chat" },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date },
    useCount: { type: Number, default: 0 },
});

memorySchema.index({ user: 1, updatedAt: -1 });

module.exports = mongoose.model("Memory", memorySchema);
