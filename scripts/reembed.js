/**
 * reembed.js — re-embeds chunks whose embedding doesn't match the active
 * EMBEDDING_DIMS / GEMINI_EMBEDDING_MODEL config.
 *
 * Usage:
 *   node scripts/reembed.js --dry-run      # count only, no writes
 *   node scripts/reembed.js                # re-embed stale chunks
 *   node scripts/reembed.js --batch 25     # batch size (default 25)
 *
 * Resumable: chunks are only marked done once re-embedded, so a crashed run
 * just picks the remaining stale ones next time. Idempotent.
 */
const dotenv = require("dotenv");
dotenv.config();
const mongoose = require("mongoose");

const DRY_RUN = process.argv.includes("--dry-run");
const batchIdx = process.argv.indexOf("--batch");
const BATCH_SIZE = batchIdx > -1 ? parseInt(process.argv[batchIdx + 1], 10) : 25;

const EMBEDDING_DIMS = parseInt(process.env.EMBEDDING_DIMS || "768", 10);
const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2";

async function main() {
    if (!process.env.MONGO_URI) {
        console.error("MONGO_URI missing");
        process.exit(1);
    }
    await mongoose.connect(process.env.MONGO_URI);
    const Chunk = require("../models/Chunk");
    const geminiHelper = require("../utils/geminiHelper");

    const staleFilter = {
        $or: [
            { embeddingDims: { $exists: false } },
            { embeddingDims: { $ne: EMBEDDING_DIMS } },
            { embeddingModel: { $exists: true, $ne: EMBEDDING_MODEL } },
        ],
    };

    const total = await Chunk.countDocuments(staleFilter);
    console.log(`[reembed] target dims=${EMBEDDING_DIMS} model=${EMBEDDING_MODEL}`);
    console.log(`[reembed] ${total} stale chunk(s) ${DRY_RUN ? "found (dry-run, no writes)" : "to re-embed"}`);
    if (DRY_RUN || total === 0) {
        await mongoose.disconnect();
        return;
    }

    let done = 0, failed = 0;
    while (true) {
        const batch = await Chunk.find(staleFilter).limit(BATCH_SIZE);
        if (!batch.length) break;

        await Promise.all(
            batch.map(async (chunk) => {
                try {
                    const text = chunk.text || chunk.pageContent;
                    const embedding = await geminiHelper.getEmbedding(text, { task: "document" });
                    chunk.embedding = embedding;
                    chunk.embeddingDims = embedding.length;
                    chunk.embeddingModel = EMBEDDING_MODEL;
                    await chunk.save();
                    done++;
                } catch (err) {
                    failed++;
                    console.error(`[reembed] chunk ${chunk._id} failed: ${err.message}`);
                    // Move on — a permanently failing chunk would loop forever,
                    // so tag it to exclude from future stale scans.
                    chunk.embeddingDims = -1;
                    await chunk.save().catch(() => {});
                }
            })
        );
        console.log(`[reembed] progress ${done + failed}/${total} (ok=${done} failed=${failed})`);
        // Gentle rate-limit spacing
        await new Promise((r) => setTimeout(r, 500));
    }

    console.log(`[reembed] complete. ok=${done} failed=${failed}`);
    await mongoose.disconnect();
}

main().catch((e) => {
    console.error("[reembed] fatal:", e);
    process.exit(1);
});
