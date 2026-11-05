/**
 * tools/index.js — agent tool registry.
 *
 * Each tool: {name, description, parameters (JSON Schema for Gemini),
 * schema (zod for validation), handler(ctx, args)}.
 * ctx = {userId, chatId, requestId, signal} injected by the server — a tool
 * NEVER trusts a userId from model args or the client.
 */
const mongoose = require("mongoose");
const { z } = require("zod");
const File = require("../models/File");
const Chunk = require("../models/Chunk");
const FlashcardSet = require("../models/FlashcardSet");
const WebSearchQuota = require("../models/WebSearchQuota");
const geminiHelper = require("../utils/geminiHelper");
const { retrieveChunks } = require("../utils/retriever");
const guard = require("../utils/guard");
const logger = require("../utils/logger");

const WEB_SEARCH_DAILY_CAP = () => parseInt(process.env.WEB_SEARCH_DAILY_CAP || "20", 10);
const CHUNK_RETURN_CHARS = 1500;
const preview = (v, n = 200) => {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
};

const utcDay = () => new Date().toISOString().slice(0, 10);
const endOfUtcDay = () => {
    const d = new Date();
    d.setUTCHours(23, 59, 59, 999);
    return d;
};

const registry = {
    search_knowledge_base: {
        name: "search_knowledge_base",
        description:
            "Search the user's uploaded knowledge-base documents. Returns the most relevant chunks with source ids for citation.",
        parameters: {
            type: "OBJECT",
            properties: {
                query: { type: "STRING", description: "What to look for in the user's documents" },
                fileIds: { type: "ARRAY", items: { type: "STRING" }, description: "Optional: restrict to these document ids" },
                topK: { type: "NUMBER", description: "Max chunks to return (<=8)" },
            },
            required: ["query"],
        },
        schema: z.object({
            query: z.string().min(1).max(500),
            fileIds: z.array(z.string()).max(10).optional(),
            topK: z.number().int().min(1).max(8).optional(),
        }),
        handler: async (ctx, args) => {
            // Silently drop file ids the user doesn't own — never leak.
            let fileIds = [];
            if (args.fileIds?.length) {
                const owned = await File.find({ _id: { $in: args.fileIds }, user: ctx.userId }).select("_id").lean();
                fileIds = owned.map((f) => f._id.toString());
            }
            const chunks = await retrieveChunks(ctx.userId, args.query, args.topK || 5, fileIds);
            return {
                chunks: chunks.map((c, i) => ({
                    sourceId: i + 1,
                    fileId: c.fileId?.toString(),
                    file: c.originalName,
                    type: c.type,
                    page: c.metadata?.page,
                    startSec: c.metadata?.startSec,
                    score: Math.round((c.score || 0) * 1000) / 1000,
                    text: (c.text || "").slice(0, CHUNK_RETURN_CHARS),
                    flagged: guard.detectInjection(c.text) || undefined,
                })),
                count: chunks.length,
            };
        },
    },

    list_documents: {
        name: "list_documents",
        description: "List the user's knowledge-base documents (id, name, kind, status).",
        parameters: { type: "OBJECT", properties: {} },
        schema: z.object({}),
        handler: async (ctx) => {
            const files = await File.find({ user: ctx.userId, isTemp: { $ne: true } })
                .select("originalName mimetype kind status uploadDate tableMeta")
                .sort({ uploadDate: -1 })
                .limit(50)
                .lean();
            return {
                documents: files.map((f) => ({
                    id: f._id.toString(),
                    name: f.originalName,
                    kind: f.kind || "doc",
                    status: f.status || "ready",
                    ...(f.tableMeta?.columns?.length ? { tabular: true, columns: f.tableMeta.columns.map((c) => c.name).slice(0, 12) } : {}),
                })),
            };
        },
    },

    get_document_overview: {
        name: "get_document_overview",
        description: "Get a short overview/summary of one of the user's documents (cached).",
        parameters: {
            type: "OBJECT",
            properties: { fileId: { type: "STRING", description: "Document id from list_documents" } },
            required: ["fileId"],
        },
        schema: z.object({ fileId: z.string().min(1) }),
        handler: async (ctx, args) => {
            const file = await File.findOne({ _id: args.fileId, user: ctx.userId });
            if (!file) return { ok: false, error: "document not found" };
            if (file.status && file.status !== "ready") return { ok: false, error: `document is ${file.status === "failed" ? "failed to ingest" : "still being ingested"}` };
            if (file.overview) return { fileId: args.fileId, name: file.originalName, overview: file.overview, cached: true };
            const text = (file.content || "").slice(0, 12000);
            if (!text.trim()) return { ok: false, error: "document has no extracted text" };
            const res = await geminiHelper.generateCheapest(
                `Summarize this document in under 120 words — what it is, key topics, and structure.\n\n${text}`,
                {},
                "tool",
                ctx.signal
            );
            const overview = geminiHelper.getText(res).trim().slice(0, 1500);
            await File.updateOne({ _id: file._id }, { $set: { overview } });
            return { fileId: args.fileId, name: file.originalName, overview, cached: false };
        },
    },

    create_flashcards: {
        name: "create_flashcards",
        description: "Generate a study flashcard set from a document or topic. Returns the set id and card count.",
        parameters: {
            type: "OBJECT",
            properties: {
                fileId: { type: "STRING", description: "Optional document id to base cards on" },
                topic: { type: "STRING", description: "Optional topic (used if no fileId or to focus)" },
                count: { type: "NUMBER", description: "Cards to create (<=20)" },
            },
        },
        schema: z.object({
            fileId: z.string().optional(),
            topic: z.string().max(200).optional(),
            count: z.number().int().min(1).max(20).optional(),
        }),
        handler: async (ctx, args) => {
            const count = args.count || 10;
            let file = null;
            if (args.fileId) {
                file = await File.findOne({ _id: args.fileId, user: ctx.userId });
                if (!file) return { ok: false, error: "document not found" };
                if (file.status && file.status !== "ready") return { ok: false, error: `document is ${file.status === "failed" ? "failed to ingest" : "still being ingested"}` };
            }
            const basis = file
                ? `the following document text:\n${(file.content || "").slice(0, 10000)}`
                : `the topic "${args.topic || "general knowledge"}"`;
            const res = await geminiHelper.generateContentWithRetry(
                `Generate ${count} study flashcards based on ${basis}. ` +
                `Return STRICT JSON array only: [{"q":"Question?","a":"Answer"}, ...]`,
                { responseMimeType: "application/json" },
                2,
                "tool",
                ctx.signal
            );
            let cards = [];
            try {
                const parsed = JSON.parse(geminiHelper.getText(res).replace(/```json|```/g, "").trim());
                if (Array.isArray(parsed)) cards = parsed.filter((c) => c && c.q && c.a).slice(0, 20);
            } catch {
                return { ok: false, error: "flashcard generation produced invalid output" };
            }
            if (!cards.length) return { ok: false, error: "no cards generated" };
            const set = await FlashcardSet.create({
                user: ctx.userId,
                name: file ? `Flashcards — ${file.originalName}` : `Flashcards — ${args.topic || "topic"}`,
                sourceFile: file?._id || null,
                sourceChat: ctx.chatId || null,
                cards: cards.map((c) => ({ q: String(c.q).slice(0, 1000), a: String(c.a).slice(0, 2000) })),
            });
            return { flashcardSetId: set._id.toString(), count: set.cards.length, name: set.name };
        },
    },

    analyze_table: {
        name: "analyze_table",
        description:
            "Analyze one of the user's CSV files with a STRUCTURED spec: filters [{col,op(eq|ne|gt|gte|lt|lte|in|contains),value}], groupBy (<=3 cols), aggs [{col,fn(sum|avg|count|min|max)}] (<=5), orderBy {col,dir}, limit (<=1000), chart {type(bar|line|pie|scatter),x,y}. Use list_documents to find the CSV's id. Returns result rows — never write code.",
        parameters: {
            type: "OBJECT",
            properties: {
                fileId: { type: "STRING", description: "CSV document id from list_documents" },
                spec: { type: "OBJECT", description: "Structured query spec — validated against the file's columns" },
            },
            required: ["fileId", "spec"],
        },
        schema: z.object({ fileId: z.string().min(1), spec: z.record(z.string(), z.any()) }),
        handler: async (ctx, args) => {
            const tableQuery = require("../services/tableQuery");
            const file = await File.findOne({ _id: args.fileId, user: ctx.userId });
            if (!file) return { ok: false, error: "document not found" };
            if (!file.tableMeta?.columns?.length) {
                return { ok: false, error: "not a CSV file — ask-data works on tabular uploads" };
            }
            const spec = tableQuery.validateSpec(args.spec, file.tableMeta);
            const tmp = await tableQuery.csvToTemp(file);
            try {
                const result = await tableQuery.executeSpec(tmp, spec, file.tableMeta);
                return {
                    file: file.originalName,
                    rows: result.rows.slice(0, 100),
                    rowCount: result.rowCount,
                    truncated: result.truncated,
                    chartSpec: result.chartSpec,
                };
            } finally {
                require("fs").unlink(tmp, () => {});
            }
        },
    },

    web_search: {
        name: "web_search",
        description: "Search the web (Google grounding) for current information. Returns an answer plus source links.",
        parameters: {
            type: "OBJECT",
            properties: { query: { type: "STRING", description: "Search query" } },
            required: ["query"],
        },
        schema: z.object({ query: z.string().min(1).max(300) }),
        handler: async (ctx, args) => {
            // Per-user daily quota
            const quota = await WebSearchQuota.findOneAndUpdate(
                { user: ctx.userId, day: utcDay() },
                { $inc: { count: 1 }, $setOnInsert: { expires: endOfUtcDay() } },
                { upsert: true, new: true }
            );
            const cap = WEB_SEARCH_DAILY_CAP();
            if (quota.count > cap) {
                return { ok: false, error: `daily web-search quota reached (${cap}/day)` };
            }
            // SEPARATE generateContent call — never combined with function declarations
            const res = await geminiHelper.generateContentWithRetry(
                `Answer concisely using web search: ${args.query}`,
                { tools: [{ googleSearch: {} }] },
                2,
                "tool",
                ctx.signal
            );
            const answer = geminiHelper.getText(res) || "";
            const chunks = res?.groundingMetadata?.groundingChunks
                || res?.candidates?.[0]?.groundingMetadata?.groundingChunks
                || [];
            const sources = chunks
                .map((c) => c.web)
                .filter((w) => w && w.uri)
                .map((w) => ({ title: w.title || w.uri, uri: w.uri }));
            return { answer: answer.slice(0, 4000), sources, quotaLeft: cap - quota.count };
        },
    },
};

/** Function declarations for the model (web_search only when browse enabled). */
function declarations({ browse = false } = {}) {
    return Object.values(registry)
        .filter((t) => t.name !== "web_search" || browse)
        .map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters }));
}

/**
 * Validate + run a tool. NEVER throws — errors become tool-results the model can read.
 * @returns {Promise<{name,ok,result?,error?,flagged?,raw}>} raw is the unwrapped output for sources/trace
 */
async function execute(name, args, ctx) {
    const tool = registry[name];
    if (!tool) {
        return { name, ok: false, error: `unknown tool "${name}"` };
    }
    const parsed = tool.schema.safeParse(args || {});
    if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        return { name, ok: false, error: `invalid arguments — ${issues}`.slice(0, 400) };
    }
    let raw;
    try {
        raw = await tool.handler(ctx, parsed.data);
        if (raw && raw.ok === false) return { name, ok: false, error: raw.error || "tool failed", raw };
    } catch (e) {
        logger.warn({ tool: name, err: e.message }, "[tools] handler threw");
        return { name, ok: false, error: `tool error: ${e.message}`.slice(0, 400) };
    }

    // Guard: tool output is untrusted data — neutralize + injection detection
    const json = JSON.stringify(raw ?? {});
    const flagged = guard.detectInjection(json);
    const content = `<tool_result name="${name}"${flagged ? ' warning="instruction-like text"' : ""}>\n${guard.neutralize(json)}\n</tool_result>`;
    return { name, ok: true, flagged, raw, result: content };
}

module.exports = { declarations, execute, registry, preview };
