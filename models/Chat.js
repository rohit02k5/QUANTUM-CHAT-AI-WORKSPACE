const mongoose = require("mongoose");

// Explicit subschema — an inline {type: String} key would trigger
// Mongoose's type-shorthand ambiguity and collapse sources to [String].
const sourceSchema = new mongoose.Schema({
    fileId: { type: mongoose.Schema.Types.ObjectId, ref: "File" },
    originalName: String,
    score: Number,
    snippet: String,
    page: Number,
    startSec: Number,
    type: String,
    matchedBy: [String], // ["vector"] | ["keyword"] | ["vector","keyword"]
    flagged: Boolean, // source contained instruction-like text (shown as data only)
    // web sources (agent browse)
    title: String,
    uri: String,
    domain: String,
});

const chatSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    title: {
        type: String,
        default: "New Chat",
    },
    pinned: {
        type: Boolean,
        default: false,
    },
    tags: {
        type: [String],
        default: [],
    },
    // Either a preset key (config/personas.js) or a Persona _id — never both.
    personaKey: { type: String, default: null },
    personaId: { type: mongoose.Schema.Types.ObjectId, ref: "Persona", default: null },
    // Semantic-search summary (Phase 4.5): <=300 chars + embedding used by
    // Smart global search. Refreshed after auto-title and every
    // SUMMARY_REFRESH_EVERY new messages.
    summary: { type: String, maxlength: 300 },
    summaryEmbedding: { type: [Number], select: false },
    summaryEmbeddingModel: { type: String },
    summaryEmbeddingDims: { type: Number },
    summaryMessageCount: { type: Number, default: 0 },
    summaryUpdatedAt: { type: Date },
    messages: [
        {
            role: {
                type: String, // 'user' or 'model'
                required: true,
            },
            content: {
                type: String,
                required: true,
            },
            sources: [sourceSchema],
            // Agent reasoning trace — {step, tool, argsPreview, ok, ms, summary}.
            // Contains no raw document text.
            trace: [
                {
                    step: Number,
                    tool: String,
                    argsPreview: String,
                    ok: Boolean,
                    ms: Number,
                    summary: String,
                },
            ],
            truncated: { type: Boolean, default: false }, // stream was aborted mid-answer
            rewrittenQuery: { type: String }, // RAG_REWRITE: retrieval used this standalone query
            timestamp: {
                type: Date,
                default: Date.now,
            },
        },
    ],
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

module.exports = mongoose.model("Chat", chatSchema);
