const mongoose = require("mongoose");

const fileSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    filename: {
        type: String,
        required: true,
    },
    originalName: {
        type: String,
        required: true,
    },
    path: {
        type: String,
        required: true,
    },
    mimetype: {
        type: String,
    },
    size: {
        type: Number,
    },
    content: {
        type: String, // Extracted text content for search/analysis
    },
    uploadDate: {
        type: Date,
        default: Date.now,
    },
    isTemp: {
        type: Boolean,
        default: false,
    },
    // Cached one-time summary (get_document_overview tool). Never regenerates.
    overview: {
        type: String,
        default: null,
    },
});

module.exports = mongoose.model("File", fileSchema);
