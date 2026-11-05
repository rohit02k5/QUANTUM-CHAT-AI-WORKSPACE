const crypto = require("crypto");
const mongoose = require("mongoose");
const logger = require("./logger");

const MAX_PER_USER = parseInt(process.env.EMBED_CACHE_MAX_PER_USER || "2000", 10);

function hashText(text, model, dims, taskType) {
    return crypto.createHash("sha256").update(`${text}|${model}|${dims}|${taskType}`).digest("hex");
}

/**
 * Look up cached vectors for `texts` under the active profile for this
 * user. Returns a Map(index -> vector). Never throws — cache failures are
 * invisible to the caller.
 */
async function lookup(userId, texts, { model, dims, taskType = "document" } = {}) {
    const hits = new Map();
    try {
        if (mongoose.connection.readyState !== 1 || !userId) return hits;
        const EmbeddingCache = require("../models/EmbeddingCache");
        const hashes = texts.map((t) => hashText(t, model, dims, taskType));
        const docs = await EmbeddingCache.find({ user: userId, hash: { $in: hashes } })
            .select("hash vector").lean();
        const byHash = new Map(docs.map((d) => [d.hash, d.vector]));
        texts.forEach((t, i) => {
            const v = byHash.get(hashes[i]);
            if (v) hits.set(i, v);
        });
    } catch (e) {
        logger.warn({ err: e.message }, "[EmbeddingCache] lookup failed");
    }
    return hits;
}

/**
 * Store freshly computed vectors. Enforces the per-user cap by evicting
 * the oldest entries (approximate LRU). Never throws.
 */
async function store(userId, entries, { model, dims, taskType = "document" } = {}) {
    try {
        if (mongoose.connection.readyState !== 1 || !userId || !entries.length) return;
        const EmbeddingCache = require("../models/EmbeddingCache");
        await EmbeddingCache.bulkWrite(entries.map(({ text, vector }) => ({
            updateOne: {
                filter: { user: userId, hash: hashText(text, model, dims, taskType) },
                update: { $set: { vector, model, dims, taskType, createdAt: new Date() } },
                upsert: true,
            },
        })), { ordered: false });
        // Cap: evict oldest beyond MAX_PER_USER (best-effort, non-atomic)
        const count = await EmbeddingCache.countDocuments({ user: userId });
        if (count > MAX_PER_USER) {
            const excess = await EmbeddingCache.find({ user: userId })
                .sort({ createdAt: 1 }).limit(count - MAX_PER_USER).select("_id").lean();
            if (excess.length) {
                await EmbeddingCache.deleteMany({ _id: { $in: excess.map((d) => d._id) } });
            }
        }
    } catch (e) {
        logger.warn({ err: e.message }, "[EmbeddingCache] store failed");
    }
}

/** Storage footprint for verification reports. */
async function stats(userId) {
    if (mongoose.connection.readyState !== 1) return { count: 0, bytes: 0 };
    const EmbeddingCache = require("../models/EmbeddingCache");
    const q = userId ? { user: userId } : {};
    const count = await EmbeddingCache.countDocuments(q);
    return { count, approxBytes: count * 768 * 8 };
}

module.exports = { lookup, store, stats, hashText, MAX_PER_USER };
