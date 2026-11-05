const mongoose = require("mongoose");
const geminiHelper = require("./geminiHelper");

const VECTOR_INDEX = process.env.ATLAS_VECTOR_SEARCH_INDEX || "chunks_embedding_index";
const EMBEDDING_DIM = parseInt(process.env.EMBEDDING_DIMS || "768", 10);
const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2";
const MIN_SCORE = parseFloat(process.env.RAG_MIN_SCORE || "0.5");
const CANDIDATES = parseInt(process.env.RAG_CANDIDATES || "20", 10);
const RRF_K = parseInt(process.env.RAG_RRF_K || "60", 10);
const HYBRID = process.env.RAG_HYBRID === "true";
const TEXT_INDEX = "chunks_text_search";
// Keyword admission: a Mongo textScore is roughly 0.58 points per matched
// term on short docs, so >=3 means ~5+ query terms matched — strong lexical
// evidence while single/stray-term matches stay out. Measured on the stress
// set: 1-2 terms injects enough noise to regress near-duplicate and
// paraphrase categories under RRF; 3 ties vector-only.
const KEYWORD_MIN_SCORE = parseFloat(process.env.RAG_KEYWORD_MIN_SCORE || "3");

// Identifier-rescue admission (Phase 5.0c): a bare textScore threshold
// structurally rejects single-token identifiers — an exact "ERR-4021" match
// scores ~0.58 and could never pass. A token that LOOKS like an identifier
// (alphanumeric containing a digit, allowing dashes/underscores/dots —
// error codes, SKUs, versions) and that appears verbatim in the chunk is
// admitted regardless of score. Boundary-checked so "4.1.7" can't match
// inside "44.1.70".
const IDENT_TOKEN = /(?=[A-Za-z0-9_.-]*\d)[A-Za-z0-9][A-Za-z0-9_.-]{2,}/g;
function identifierTokens(query) {
    return [...new Set((String(query).match(IDENT_TOKEN) || []).filter((t) => t.length >= 3))];
}
function matchesIdentifier(text, token) {
    const esc = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^A-Za-z0-9])${esc}([^A-Za-z0-9]|$)`, "i").test(text);
}
function admitKeyword(chunk, queryTokens) {
    if (chunk.score >= KEYWORD_MIN_SCORE) return true;
    const text = chunk.text || chunk.pageContent || "";
    return queryTokens.some((tok) => matchesIdentifier(text, tok));
}

// $vectorSearch on a collection without the index returns [] (no error) on
// Atlas, so a missing index can never reach the cosine fallback. Check it
// explicitly. Only a positive verdict is cached — an index created later is
// picked up on the next query without a restart.
let _indexVerified = false;
async function vectorIndexAvailable() {
    if (_indexVerified) return true;
    try {
        const idx = await mongoose.connection.collection("chunks")
            .listSearchIndexes().toArray();
        _indexVerified = idx.some((i) => i.name === VECTOR_INDEX);
        return _indexVerified;
    } catch {
        // listSearchIndexes unsupported (non-Atlas): try $vectorSearch anyway —
        // its error path still reaches the fallback.
        return true;
    }
}

let _textIndexVerified = false;
async function textIndexAvailable() {
    if (_textIndexVerified) return true;
    try {
        const idx = await mongoose.connection.collection("chunks").listIndexes().toArray();
        _textIndexVerified = idx.some((i) => i.name === TEXT_INDEX);
        return _textIndexVerified;
    } catch {
        return false;
    }
}

/**
 * Ensure the keyword-leg index exists: compound {user:1, text:"text"} —
 * the user equality prefix keeps every $text query owner-scoped at the
 * index level. default_language "none" is deliberate: it disables stemming
 * and stop-words, which hurt non-English corpora less than they help
 * English (no new Atlas Search index; this is a regular Mongo index).
 * Any conflicting text index is dropped first (Mongo allows exactly one
 * text index per collection). Idempotent; called once at server boot.
 */
async function ensureTextIndex() {
    const coll = mongoose.connection.collection("chunks");
    // listIndexes throws NamespaceNotFound on a fresh DB — treat as none.
    const idx = await coll.listIndexes().toArray().catch(() => []);
    for (const i of idx) {
        const isText = Object.values(i.key || {}).includes("text");
        if (isText && i.name !== TEXT_INDEX) await coll.dropIndex(i.name).catch(() => {});
    }
    await coll.createIndex(
        { user: 1, text: "text" },
        { name: TEXT_INDEX, default_language: "none" }
    );
    _textIndexVerified = true;
    return TEXT_INDEX;
}

// The keyword leg is a RESCUE leg: it exists to surface exact identifiers the
// vector leg misses, not to reorder semantic hits. An unweighted leg lets
// noisy lexical matches outrank the best vector hit (measured: paraphrase and
// near-duplicate categories regressed). Weighting keyword contribution at
// RAG_KEYWORD_WEIGHT (default 0.5) keeps a keyword-only hit below the top
// vector hit while still boosting docs found by both legs.
const KEYWORD_WEIGHT = parseFloat(process.env.RAG_KEYWORD_WEIGHT || "0.5");

/** Reciprocal Rank Fusion — score(doc) = Σ weight/(k + rank). */
function rrf(lists, k = RRF_K) {
    const fused = new Map(); // chunkId -> {chunk, fused, legs}
    lists.forEach(({ leg, weight = 1, results }) => {
        results.forEach((c, rank) => {
            const id = c._id.toString();
            const e = fused.get(id) || { chunk: c, fused: 0, legs: [] };
            e.fused += weight / (k + rank + 1);
            e.legs.push(leg);
            // Merge leg scores without losing the richer doc
            if (leg === "vector") e.vectorScore = c.score;
            if (leg === "keyword") e.keywordScore = c.score;
            e.chunk = c;
            fused.set(id, e);
        });
    });
    return [...fused.values()].sort((a, b) => b.fused - a.fused);
}

/**
 * Retrieve the top-K most relevant chunks for a user query.
 *
 * @param {string|ObjectId} userId
 * @param {string} query
 * @param {number} topK
 * @param {string[]|ObjectId[]} [fileIds] - optional: scope retrieval to these files only
 * @param {object} [opts] - {mode:"vector"|"keyword"|"hybrid", candidates}
 *
 * Every returned item keeps the backward-compatible shape and adds:
 *   score        - vector cosine when the chunk came from the vector leg,
 *                  else the fused score (never a fake cosine for keyword hits)
 *   scores       - {vector?, keyword?, fused}
 *   matchedBy    - ["vector"] | ["keyword"] | ["vector","keyword"]
 *   text, pageContent, originalName, metadata, fileId, type (as before)
 */
async function retrieveChunks(userId, query, topK = 3, fileIds = [], opts = {}) {
    const mode = opts.mode || (HYBRID ? "hybrid" : "vector");
    const candidates = opts.candidates || CANDIDATES;
    const userObjectId =
        userId instanceof mongoose.Types.ObjectId ? userId : new mongoose.Types.ObjectId(userId);
    const fileObjectIds = (fileIds || [])
        .filter((id) => id && (id instanceof mongoose.Types.ObjectId || mongoose.Types.ObjectId.isValid(id)))
        .map((id) => (id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(id)));

    // Only files that finished ingestion are retrievable — a "processing" or
    // "failed" file's partial chunks must never leak into the prompt. Legacy
    // records have no status field and count as ready ($nin matches missing).
    const readyFiles = await mongoose.connection.collection("files")
        .find(
            { user: userObjectId, status: { $nin: ["processing", "failed"] }, isTemp: { $ne: true } },
            { projection: { _id: 1 } }
        )
        .toArray();
    const readyIds = new Set(readyFiles.map((f) => f._id.toString()));
    const scopedIds = fileObjectIds.length
        ? fileObjectIds.filter((id) => readyIds.has(id.toString()))
        : readyFiles.map((f) => f._id);
    if (!scopedIds.length) return [];

    const scopeFilter = { user: userObjectId, file: { $in: scopedIds } };
    // Both legs apply identical filters: owner, file scope, ready-only files,
    // and embedding-model/dims match (a chunk from another config is never
    // returned, whichever leg found it).
    const dimsFilter = {
        $and: [
            // Model must match the active embedding config; chunks that
            // predate the field (legacy) are tolerated, an explicit
            // DIFFERENT model is a real mismatch and ignored.
            { $or: [{ embeddingModel: EMBEDDING_MODEL }, { embeddingModel: { $exists: false } }] },
            {
                $or: [
                    { embeddingDims: EMBEDDING_DIM },
                    { embeddingDims: { $exists: false }, embedding: { $size: EMBEDDING_DIM } },
                ],
            },
        ],
    };

    // ---- vector leg ----
    let vectorResults = [];
    if (mode !== "keyword") {
        // opts.queryVector lets callers reuse one embedding across RAG and
        // memory retrieval (Phase 5.1) instead of embedding twice.
        let queryVector = opts.queryVector;
        try {
            if (!queryVector) queryVector = await geminiHelper.getEmbedding(query, { task: "query" });
            if (!Array.isArray(queryVector) || queryVector.length !== EMBEDDING_DIM) queryVector = null;
        } catch { queryVector = null; }

        if (queryVector) {
            if (await vectorIndexAvailable()) try {
                vectorResults = await mongoose.connection.collection("chunks").aggregate([
                    {
                        $vectorSearch: {
                            index: VECTOR_INDEX,
                            path: "embedding",
                            queryVector,
                            numCandidates: Math.max(candidates * 10, 100),
                            limit: candidates,
                            filter: {
                                ...scopeFilter,
                                embeddingDims: EMBEDDING_DIM,
                                $or: [{ embeddingModel: EMBEDDING_MODEL }, { embeddingModel: { $exists: false } }],
                            },
                            similarity: "cosine",
                        },
                    },
                    { $project: { text: 1, pageContent: 1, metadata: 1, type: 1, file: 1, score: { $meta: "vectorSearchScore" } } },
                ]).toArray();
                vectorResults = vectorResults.filter((c) => c.score === undefined || c.score >= MIN_SCORE);
            } catch {
                vectorResults = [];
            }
            if (!vectorResults.length) {
                // Cosine fallback — index missing/erroring or Atlas leg empty.
                const allChunks = await mongoose.connection.collection("chunks").find({
                    ...scopeFilter, ...dimsFilter,
                }).toArray();
                vectorResults = allChunks
                    .map((c) => ({ ...c, score: cosineSimilarity(queryVector, c.embedding) }))
                    .filter((c) => c.score >= MIN_SCORE)
                    .sort((a, b) => b.score - a.score)
                    .slice(0, candidates);
            }
        }
    }

    // ---- keyword leg (Mongo text index — owner-scoped by index prefix) ----
    let keywordResults = [];
    if (mode !== "vector" && query.trim()) {
        try {
            if (!(await textIndexAvailable())) throw new Error("text index missing");
            keywordResults = await mongoose.connection.collection("chunks")
                .find(
                    { ...scopeFilter, ...dimsFilter, $text: { $search: query } },
                    { projection: { text: 1, pageContent: 1, metadata: 1, type: 1, file: 1, score: { $meta: "textScore" } } }
                )
                .sort({ score: { $meta: "textScore" } })
                .limit(candidates)
                .toArray();
            const queryTokens = identifierTokens(query);
            keywordResults = keywordResults.filter((c) => admitKeyword(c, queryTokens));
        } catch {
            keywordResults = [];
        }
    }

    // ---- fuse / select ----
    let merged;
    if (mode === "vector") {
        merged = vectorResults.slice(0, topK).map((c) => ({
            c, vectorScore: c.score, fused: c.score, legs: ["vector"],
        }));
    } else if (mode === "keyword") {
        merged = keywordResults.slice(0, topK).map((c) => ({
            c, keywordScore: c.score, fused: c.score, legs: ["keyword"],
        }));
    } else {
        merged = rrf([
            { leg: "vector", results: vectorResults },
            { leg: "keyword", results: keywordResults, weight: KEYWORD_WEIGHT },
        ]).slice(0, topK).map((e) => ({ ...e, c: e.chunk }));
    }
    if (!merged.length) return [];

    // Optional LLM rerank (RAG_RERANK / opts.rerank) — silently falls back
    // to the fused order on any error, invalid output, or timeout.
    if (opts.rerank === true || (opts.rerank !== false && process.env.RAG_RERANK === "true")) {
        const byId = new Map(merged.map((m) => [String(m.c._id), m]));
        const reranked = await require("./rerank").rerankChunks({
            userId, query,
            chunks: merged.map((m) => m.c),
        });
        merged = reranked.map((c) => byId.get(String(c._id)) || { c, fused: 0, legs: [] });
    }

    // Enrich with filenames for the citation layer.
    const fileIdSet = [...new Set(merged.map((m) => (m.c.file || m.c.fileId).toString()))];
    const files = await mongoose.connection.collection("files")
        .find({ _id: { $in: fileIdSet.map((id) => new mongoose.Types.ObjectId(id)) } })
        .toArray();
    const nameMap = new Map(files.map((f) => [f._id.toString(), f.originalName]));

    return merged.map((m) => {
        const c = m.c;
        const fileId = c.file || c.fileId;
        const matchedBy = m.legs;
        return {
            _id: c._id,
            text: c.text || c.pageContent || "",
            pageContent: c.pageContent || c.text || "",
            metadata: c.metadata || {},
            type: c.type,
            fileId,
            originalName: nameMap.get(fileId?.toString()) || "Unknown Source",
            // Backward compat: `score` stays a vector cosine when there is
            // one; keyword-only hits get the fused score so chips never show
            // a misleading cosine number.
            score: m.vectorScore ?? m.fused,
            scores: {
                vector: m.vectorScore,
                keyword: m.keywordScore,
                fused: m.fused,
            },
            matchedBy,
        };
    });
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

/** Exposed for tests and the retrieval eval. */
module.exports = {
    retrieveChunks,
    buildContext,
    cosineSimilarity,
    VECTOR_INDEX,
    TEXT_INDEX,
    EMBEDDING_MODEL,
    EMBEDDING_DIMS: EMBEDDING_DIM,
    ensureTextIndex,
    rrf,
    identifierTokens,
    admitKeyword,
    _resetIndexCache: () => { _indexVerified = false; _textIndexVerified = false; },
};
