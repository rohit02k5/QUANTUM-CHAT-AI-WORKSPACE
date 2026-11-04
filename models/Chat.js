const mongoose = require("mongoose");

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
            sources: [
                {
                    fileId: { type: mongoose.Schema.Types.ObjectId, ref: "File" },
                    originalName: String,
                    score: Number,
                    snippet: String,
                    page: Number,
                    flagged: Boolean, // source contained instruction-like text (shown as data only)
                },
            ],
            truncated: { type: Boolean, default: false }, // stream was aborted mid-answer
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
