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
        type: String, // legacy local-disk path (pre-GridFS); null for GridFS files
    },
    // GridFS object id in bucket "uploads" — canonical byte store (Phase 3A)
    gridfsId: { type: mongoose.Schema.Types.ObjectId },
    kind: { type: String, enum: ["doc", "audio"], default: "doc" },
    // Ingestion status: files that aren't "ready" are excluded from RAG/agent
    status: { type: String, enum: ["processing", "ready", "failed"], default: "ready" },
    durationSec: { type: Number }, // audio files only
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
