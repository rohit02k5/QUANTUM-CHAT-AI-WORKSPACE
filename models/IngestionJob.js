const mongoose = require("mongoose");

/**
 * IngestionJob — resumable, crash-safe ingestion pipeline record.
 *
 * Lifecycle: queued -> processing -> done | failed.
 * `stage` tracks which pipeline phase it's in; `state` carries resumable
 * checkpoints (e.g. next chunkIndex to embed, finished transcript segments)
 * so a restarted job never redoes completed work.
 */
const ingestionJobSchema = new mongoose.Schema(
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        file: { type: mongoose.Schema.Types.ObjectId, ref: "File", required: true },
        // Job kind: "ingest" (default upload pipeline), "reprocess" (regenerate
        // text chunks e.g. for page metadata — prunes text chunks, never touches
        // figure/image), "deep-analysis" (3B.3 vision pass over a page range).
        kind: {
            type: String,
            enum: ["ingest", "reprocess", "deep-analysis"],
            default: "ingest",
        },
        status: {
            type: String,
            enum: ["queued", "processing", "done", "failed"],
            default: "queued",
        },
        stage: {
            type: String,
            enum: ["extract", "transcribe", "chunk", "embed", "index", "describe"],
            default: "extract",
        },
        progress: { type: Number, default: 0, min: 0, max: 100 },
        attempts: { type: Number, default: 0 },
        error: { type: String },
        lockedAt: { type: Date },
        // Resumable checkpoint data — shape depends on stage:
        //   {nextChunkIndex}                 embed: first un-embedded chunk index
        //   {segments: [{index,startSec,endSec,done,segments}]}  transcribe
        state: { type: Object, default: {} },
    },
    { timestamps: true }
);

ingestionJobSchema.index({ status: 1, updatedAt: 1 });
ingestionJobSchema.index({ user: 1, createdAt: -1 });
ingestionJobSchema.index({ file: 1 });

module.exports = mongoose.model("IngestionJob", ingestionJobSchema);
