const mongoose = require("mongoose");

const chunkSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    file: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "File",
        required: true,
    },
    text: {
        type: String,
        required: true,
    },
    // Redundant with text for migration, but matches the PDF's Document convention
    pageContent: {
        type: String,
    },
    metadata: {
        type: Object,
        default: {},
    },
    embedding: {
        type: [Number],
        required: true,
    },
});

module.exports = mongoose.model("Chunk", chunkSchema);