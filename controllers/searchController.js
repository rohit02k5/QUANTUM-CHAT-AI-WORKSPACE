const Chat = require("../models/Chat");
const File = require("../models/File");
const geminiHelper = require("../utils/geminiHelper");
const { retrieveChunks, cosineSimilarity, EMBEDDING_MODEL, EMBEDDING_DIMS } = require("../utils/retriever");
const logger = require("../utils/logger");

const MAX_RESULTS = 50;
const SEARCH_MAX_CHATS = parseInt(process.env.SEARCH_MAX_CHATS || "500", 10);
const RRF_K = 60;
const LAZY_BACKFILL_MAX = 10;

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * GET /api/v1/search?query=…&mode=smart|exact
 *
 * Exact: escaped-regex search (unchanged legacy behavior, owner-scoped,
 * capped + maxTimeMS).
 * Smart (default): hybrid semantic search — files via the retriever across
 * all READY files, chats via summary embeddings (in-process cosine over a
 * capped projection) fused with title/summary keyword matches (RRF).
 * Response grouped: {chats:[{id,title,snippet,score,matchType}],
 *                    files:[{id,name,snippet,page|startSec,score}]}.
 */
exports.globalSearch = async (req, res) => {
    try {
        const query = (req.query.query || "").toString().trim();
        const mode = req.query.mode === "exact" ? "exact" : "smart";
        if (!query) return res.status(400).json({ message: "Query required" });

        const userId = req.user._id;
        const results = mode === "exact" ? await exactSearch(userId, query) : await smartSearch(userId, query);
        res.status(200).json(results);
    } catch (error) {
        logger.error({ err: error.message }, "[search] failed");
        res.status(500).json({ message: "Search failed" });
    }
};

async function exactSearch(userId, query) {
    const regex = new RegExp(escapeRegExp(query), "i");
    const [files, chats] = await Promise.all([
        File.find({ user: userId, $or: [{ originalName: regex }, { content: regex }] })
            .select("originalName fileType content")
            .limit(MAX_RESULTS).maxTimeMS(2000).lean(),
        Chat.find({ user: userId, $or: [{ title: regex }, { "messages.content": regex }] })
            .select("title messages")
            .limit(MAX_RESULTS).maxTimeMS(2000).lean(),
    ]);
    return {
        files: files.map((f) => ({
            id: f._id, name: f.originalName,
            snippet: (f.content || "").substring(0, 200), score: 1,
            // legacy fields
            _id: f._id, fileName: f.originalName, description: (f.content || "").substring(0, 200), type: "file",
        })),
        chats: chats.map((c) => ({
            id: c._id, title: c.title,
            snippet: (c.messages?.[0]?.content || c.title || "").substring(0, 200),
            score: 1, matchType: "exact",
            _id: c._id, fileName: c.title, description: (c.messages?.[0]?.content || "").substring(0, 200), type: "chat",
        })),
    };
}

async function smartSearch(userId, query) {
    const [files, chats] = await Promise.all([
        smartFileSearch(userId, query),
        smartChatSearch(userId, query),
    ]);
    return { files, chats };
}

/** File leg: hybrid retriever over all READY files, best chunk per file. */
async function smartFileSearch(userId, query) {
    const chunks = await retrieveChunks(userId, query, 8).catch((e) => {
        logger.warn({ err: e.message }, "[search] file retrieval failed");
        return [];
    });
    if (!chunks.length) return [];
    const byFile = new Map();
    for (const c of chunks) {
        const key = String(c.fileId);
        if (!byFile.has(key)) byFile.set(key, c); // chunks arrive best-first
    }
    const ids = [...byFile.keys()];
    const files = await File.find({ _id: { $in: ids }, user: userId }).select("originalName fileType").lean();
    const nameOf = new Map(files.map((f) => [String(f._id), f.originalName]));
    return ids.filter((id) => nameOf.has(id)).map((id) => {
        const c = byFile.get(id);
        return {
            id,
            name: nameOf.get(id),
            snippet: (c.text || "").substring(0, 200),
            page: c.metadata?.page,
            startSec: c.metadata?.startSec,
            score: c.score,
            // legacy fields
            _id: id, fileName: nameOf.get(id), description: (c.text || "").substring(0, 200), type: "file",
        };
    });
}

/**
 * Chat leg: semantic over summary embeddings + keyword over title/summary,
 * fused with RRF. Capped, projected, owner-scoped, in-process cosine —
 * no new Atlas index.
 */
async function smartChatSearch(userId, query) {
    const [queryEmbedding, chats] = await Promise.all([
        geminiHelper.getEmbedding(query, { task: "query" }).catch(() => null),
        Chat.find({ user: userId })
            .select("title summary summaryEmbedding summaryEmbeddingDims summaryEmbeddingModel messages")
            .sort({ createdAt: -1 })
            .limit(SEARCH_MAX_CHATS)
            .lean(),
    ]);

    // Vector leg — only summaries embedded with the active model/dims count
    const vectorRanked = [];
    if (queryEmbedding) {
        for (const c of chats) {
            if (
                Array.isArray(c.summaryEmbedding) &&
                c.summaryEmbedding.length === EMBEDDING_DIMS &&
                c.summaryEmbeddingModel === EMBEDDING_MODEL &&
                c.summaryEmbeddingDims === EMBEDDING_DIMS
            ) {
                vectorRanked.push({ chat: c, score: cosineSimilarity(queryEmbedding, c.summaryEmbedding) });
            }
        }
        vectorRanked.sort((a, b) => b.score - a.score);
    }

    // Keyword leg — term coverage on title+summary
    const terms = [...new Set(query.toLowerCase().split(/\W+/).filter((t) => t.length > 2))];
    const keywordRanked = [];
    if (terms.length) {
        for (const c of chats) {
            const hay = `${c.title || ""} ${c.summary || ""}`.toLowerCase();
            const hits = terms.filter((t) => hay.includes(t)).length;
            if (hits > 0) keywordRanked.push({ chat: c, score: hits / terms.length });
        }
        keywordRanked.sort((a, b) => b.score - a.score);
    }

    // RRF fuse — chat_id-keyed, deterministic tie-break on score then id
    const fused = new Map();
    const addLeg = (ranked, leg) => ranked.forEach((r, i) => {
        const id = String(r.chat._id);
        const cur = fused.get(id) || { chat: r.chat, fused: 0, legs: [], score: 0 };
        cur.fused += 1 / (RRF_K + i + 1);
        cur.legs.push(leg);
        cur.score = Math.max(cur.score, r.score);
        fused.set(id, cur);
    });
    addLeg(vectorRanked, "vector");
    addLeg(keywordRanked, "keyword");

    const top = [...fused.values()]
        .sort((a, b) => b.fused - a.fused || b.score - a.score || String(a.chat._id).localeCompare(String(b.chat._id)))
        .slice(0, 10);

    // Lazy bounded backfill — schedules summaries for recent chats that lack
    // one; never awaited so it can't block the response.
    lazyBackfill(userId, chats).catch(() => {});

    return top.map(({ chat, fused: f, legs, score }) => ({
        id: chat._id,
        title: chat.title,
        snippet: (chat.summary || chat.messages?.[0]?.content || chat.title || "").substring(0, 200),
        score: f,
        matchType: legs.join("+"),
        // legacy fields
        _id: chat._id, fileName: chat.title, description: (chat.summary || "").substring(0, 200), type: "chat",
    }));
}

async function lazyBackfill(userId, chats) {
    const { maybeSummarizeChat, needsSummary } = require("../utils/chatSummary");
    let scheduled = 0;
    for (const c of chats) {
        if (scheduled >= LAZY_BACKFILL_MAX) break;
        if (!c.summary && Array.isArray(c.messages) && c.messages.length >= 2) {
            scheduled++;
            maybeSummarizeChat(c._id).catch(() => {});
        }
    }
}
