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
    // Which model/dims produced this embedding — retrieval only considers
    // chunks matching the active config (see EMBEDDING_DIMS).
    embeddingModel: { type: String },
    embeddingDims: { type: Number },
    // chunk "type" for future multimodal chunks (text | figure | image | audio)
    type: { type: String, default: "text" },
});

chunkSchema.index({ user: 1, file: 1 });
chunkSchema.index({ text: "text" }); // keyword leg for hybrid search (Phase 4)

module.exports = mongoose.model("Chunk", chunkSchema);