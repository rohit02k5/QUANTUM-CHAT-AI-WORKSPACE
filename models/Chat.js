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
                },
            ],
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
