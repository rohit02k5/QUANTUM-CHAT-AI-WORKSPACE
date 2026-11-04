const mongoose = require("mongoose");
const geminiHelper = require("./geminiHelper");

const VECTOR_INDEX = process.env.ATLAS_VECTOR_SEARCH_INDEX || "chunks_embedding_index";
const EMBEDDING_DIM = parseInt(process.env.EMBEDDING_DIMS || "768", 10);
const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2";
const MIN_SCORE = parseFloat(process.env.RAG_MIN_SCORE || "0.5");

/**
 * Retrieve the top-K most relevant chunks for a user query.
 *
 * @param {string|ObjectId} userId
 * @param {string} query
 * @param {number} topK
 * @param {string[]|ObjectId[]} [fileIds] - optional: scope retrieval to these files only
 *
 * Each returned item has:
 *   text        - chunk content (pageContent)
 *   originalName - source filename
 *   metadata     - chunk metadata (page, chunkIndex, chunkTotal, ...)
 *   score        - normalized cosine similarity
 *   fileId       - parent File _id
 */
async function retrieveChunks(userId, query, topK = 3, fileIds = []) {
    const userObjectId =
        userId instanceof mongoose.Types.ObjectId ? userId : new mongoose.Types.ObjectId(userId);
    const fileObjectIds = (fileIds || [])
        .filter((id) => id && (id instanceof mongoose.Types.ObjectId || mongoose.Types.ObjectId.isValid(id)))
        .map((id) => (id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(id)));

    // 1. Embed the query (task-typed for retrieval)
    let queryVector;
    try {
        queryVector = await geminiHelper.getEmbedding(query, { task: "query" });
        if (!Array.isArray(queryVector) || queryVector.length !== EMBEDDING_DIM) {
            console.warn("[Retriever] Query embedding dimension mismatch:", queryVector?.length);
            return [];
        }
    } catch (err) {
        console.warn("[Retriever] Query embedding failed:", err.message);
        return [];
    }

    // 2. Try Atlas Vector Search
    const scopeFilter = { user: userObjectId };
    if (fileObjectIds.length > 0) scopeFilter.file = { $in: fileObjectIds };
    // Only chunks embedded at the active dimensionality are comparable
    const vectorFilter = { ...scopeFilter, embeddingDims: EMBEDDING_DIM };

    try {
        const chunks = await mongoose.connection.collection("chunks").aggregate([
            {
                $vectorSearch: {
                    index: VECTOR_INDEX,
                    path: "embedding",
                    queryVector,
                    numCandidates: Math.max(topK * 10, 20),
                    limit: topK,
                    filter: vectorFilter,
                    similarity: "cosine",
                },
            },
            {
                $lookup: { from: "files", localField: "file", foreignField: "_id", as: "fileDoc" },
            },
            {
                $project: {
                    text: 1,
                    pageContent: 1,
                    metadata: 1,
                    fileId: "$file",
                    originalName: { $arrayElemAt: ["$fileDoc.originalName", 0] },
                    score: { $meta: "vectorSearchScore" },
                },
            },
        ]).toArray();
        // Drop weak matches — irrelevant chunks shouldn't pollute the prompt
        return chunks.filter((c) => c.score === undefined || c.score >= MIN_SCORE);
    } catch (err) {
        console.warn("[Retriever] Atlas vector search unavailable, using local fallback...");
    }

    // 3. Local fallback: cosine similarity over this user's chunks.
    // Only consider chunks embedded with the active dims — stale chunks from
    // an older embedding config can't be compared.
    const allChunks = await mongoose.connection.collection("chunks").find({
        ...scopeFilter,
        $or: [{ embeddingDims: EMBEDDING_DIM }, { embeddingDims: { $exists: false }, embedding: { $size: EMBEDDING_DIM } }],
    }).toArray();
    const scored = allChunks
        .map((c) => ({
            ...c,
            fileId: c.file,
            score: cosineSimilarity(queryVector, c.embedding),
        }))
        .filter((c) => c.score >= MIN_SCORE)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);

    // Enrich with filename
    const scoredFileIds = [...new Set(scored.map((c) => c.fileId))];
    const files = await mongoose.connection.collection("files").find({ _id: { $in: scoredFileIds } }).toArray();
    const nameMap = new Map(files.map((f) => [f._id.toString(), f.originalName]));

    return scored.map((c) => ({
        text: c.text || c.pageContent || "",
        pageContent: c.pageContent || c.text || "",
        metadata: c.metadata || {},
        fileId: c.fileId,
        originalName: nameMap.get(c.fileId?.toString()) || "Unknown Source",
        score: c.score,
    }));
}

/** Format chunks into a prompt context block with citations metadata. */
function buildContext(chunks) {
    return chunks
        .map((c, i) => {
            const src = c.originalName || "document";
            const page = c.metadata && c.metadata.page !== undefined ? ` (page ${c.metadata.page})` : "";
            return `[Source ${i + 1}: ${src}${page}]\n${c.text.trim()}\n[End Source ${i + 1}]`;
        })
        .join("\n\n");
}

/** Cosine similarity between two vectors. */
function cosineSimilarity(a, b) {
    if (a.length !== b.length) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

module.exports = { retrieveChunks, buildContext, VECTOR_INDEX };