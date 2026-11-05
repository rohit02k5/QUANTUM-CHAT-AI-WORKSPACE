const mongoose = require("mongoose");
const Chat = require("../models/Chat");
const Chunk = require("../models/Chunk");
const Persona = require("../models/Persona");
const PERSONA_PRESETS = require("../config/personas");
const { retrieveChunks } = require("../utils/retriever");
const { removeFileArtifacts } = require("./fileController");
const geminiHelper = require("../utils/geminiHelper");
const guard = require("../utils/guard");
const logger = require("../utils/logger");
const { getRequestId } = require("../utils/requestContext");
const dotenv = require("dotenv");
dotenv.config();

const RAG_TOP_K = parseInt(process.env.RAG_TOP_K || "3", 10);
const MAX_ATTACH_CHARS = parseInt(process.env.MAX_ATTACH_CHARS || "12000", 10);
const TITLE_MAX_LEN = 60;

// ---------------------------------------------------------------------------
// Shared helpers (sendMessage + streamMessage build identical prompts)
// ---------------------------------------------------------------------------

/** Resolve the active persona's system prompt for a chat (preset key or owned Persona). */
async function resolvePersonaPrompt(chat) {
    if (chat.personaKey && PERSONA_PRESETS[chat.personaKey]) {
        return PERSONA_PRESETS[chat.personaKey].systemPrompt;
    }
    if (chat.personaId) {
        const persona = await Persona.findOne({ _id: chat.personaId, user: chat.user }).lean();
        if (persona) return persona.systemPrompt;
    }
    return null;
}

/** Build windowed conversation history in the same shape for both paths. */
function buildHistory(chat) {
    return chat.messages
        .slice(0, -1) // exclude the just-added user message
        .slice(-20)
        .map((msg) => ({
            role: msg.role === "user" ? "user" : "model",
            parts: [{ text: msg.content || " " }],
        }));
}

/**
 * RAG retrieval + attachment excerpt + persona/system-instruction assembly.
 * Retrieved chunks are wrapped in <source> delimiters and flagged for
 * instruction-like text; the guardrail block is appended last.
 */
async function prepareMessageContext(userId, chat, message, { useDocuments, documentIds, fileId, memoryEnabled }) {
    const mem = require("../utils/memory");
    let prompt = message;
    let sources = [];
    let rewrittenQuery;
    let memoryBlock = null;
    let usedMemories = [];
    let usedMemoryDetails = [];
    let queryVector = null;
    let keywordOnly = false;

    const hasDocs = useDocuments !== false && (await Chunk.exists({ user: userId }));
    if (hasDocs) {
        try {
            const scopedIds = Array.isArray(documentIds) ? documentIds : [];
            // RAG_REWRITE: condense context-dependent follow-ups for retrieval
            // ONLY — the stored user message stays verbatim.
            const rw = await require("../utils/queryRewrite").maybeRewriteQuery(
                message,
                chat.messages.slice(0, -1).slice(-4)
            );
            if (rw.rewritten) rewrittenQuery = rw.query;

            // Memory + RAG share ONE query embedding: pull the relevant
            // memories first (zero embed for users with none) and hand its
            // vector to the retriever so the turn costs one embed, not two.
            if (memoryEnabled) {
                try {
                    const { memories, vector } = await mem.getRelevantMemories(userId, rw.query, { withVector: true });
                    if (vector) queryVector = vector;
                    const built = mem.buildMemoryBlock(memories);
                    memoryBlock = built.block;
                    usedMemories = built.usedIds;
                    usedMemoryDetails = built.used;
                } catch (e) {
                    logger.warn({ err: e.message }, "[Chat][Memory] retrieval error");
                }
            }

            const chunks = await retrieveChunks(userId, rw.query, RAG_TOP_K, scopedIds, { queryVector });
            if (chunks.keywordOnly) keywordOnly = true;
            if (chunks.length > 0) {
                const { context, flags } = guard.wrapSources(chunks);
                prompt = guard.buildRagPrompt(message, context);
                sources = chunks.map((c, i) => ({
                    fileId: c.fileId,
                    originalName: c.originalName,
                    type: c.type,
                    page: c.metadata?.page,
                    startSec: c.metadata?.startSec,
                    score: c.score,
                    matchedBy: c.matchedBy,
                    snippet: (c.text || "").substring(0, 200),
                    flagged: flags[i] || undefined,
                }));
                logger.info({ chunks: chunks.length, flagged: flags.filter(Boolean).length }, "[Chat][RAG] retrieved");
            }
        } catch (ragErr) {
            // Never break normal chat because RAG failed
            logger.warn({ err: ragErr.message }, "[Chat][RAG] retrieval error");
        }
    }

    // No-doc path (agent mode, empty KB): memory still applies — embed the
    // raw message once. RAG retrieval doesn't run so there is no shared
    // vector to reuse.
    if (memoryEnabled && !hasDocs) {
        try {
            const memories = await mem.getRelevantMemories(userId, message);
            const built = mem.buildMemoryBlock(memories);
            memoryBlock = built.block;
            usedMemories = built.usedIds;
            usedMemoryDetails = built.used;
        } catch (e) {
            logger.warn({ err: e.message }, "[Chat][Memory] retrieval error");
        }
    }

    let tempFileDoc = null;
    if (fileId) {
        try {
            const ChatFile = require("../models/File");
            const fileDoc = await ChatFile.findOne({ _id: fileId, user: userId });
            if (fileDoc && fileDoc.content) {
                const excerpt = fileDoc.content.length > MAX_ATTACH_CHARS
                    ? fileDoc.content.substring(0, MAX_ATTACH_CHARS) + "\n[...truncated]"
                    : fileDoc.content;
                prompt += `\n\n${guard.wrapAttachment(fileDoc.originalName, excerpt)}`;
                if (fileDoc.isTemp) tempFileDoc = fileDoc;
            }
        } catch (fileErr) {
            logger.warn({ err: fileErr.message }, "[Chat] attachment error");
        }
    }

    const personaPrompt = await resolvePersonaPrompt(chat);
    const systemInstruction = guard.buildSystemInstruction({ personaPrompt, memoryBlock });
    return { prompt, sources, tempFileDoc, systemInstruction, rewrittenQuery, memoryBlock, usedMemories, usedMemoryDetails, keywordOnly };
}

/**
 * Fire-and-forget post-reply work: chat-summary refresh (Phase 4.5) and
 * long-term memory extraction (Phase 5.1). Neither may block or fail the
 * chat response.
 */
function afterAssistantReply(chat, user) {
    require("../utils/chatSummary").maybeSummarizeChat(chat._id).catch((e) =>
        logger.warn({ err: e.message }, "[Chat] summary refresh failed"));
    const mem = require("../utils/memory");
    if (mem.shouldExtract(chat, user?.memoryEnabled !== false)) {
        mem.extractMemories(chat.user, chat, { email: user?.email }).catch(() => {});
    }
}

/** Fire-and-forget title generation on the cheapest model. Never blocks. */
function autoTitle(chat) {
    const first = chat.messages.find((m) => m.role === "user");
    if (!first) return;
    const prompt =
        `Write a very short title (max ${TITLE_MAX_LEN} chars, no quotes, no punctuation at the end) ` +
        `for a chat whose first user message is:\n"${first.content.substring(0, 500)}"`;
    geminiHelper
        .generateCheapest(prompt, {}, "chat")
        .then(async (res) => {
            const title = geminiHelper.getText(res).trim().replace(/^["']+|["']+$/g, "").substring(0, TITLE_MAX_LEN);
            if (title) {
                await Chat.updateOne({ _id: chat._id }, { $set: { title } });
            }
        })
        .catch((e) => logger.warn({ err: e.message }, "[Chat] auto-title failed (keeping truncated fallback)"));
}

/** Resolve an incoming persona value: preset key, owned Persona id, or null. */
async function resolvePersonaValue(userId, value) {
    if (value === null || value === "" || value === undefined) return { personaKey: null, personaId: null };
    if (typeof value === "string" && PERSONA_PRESETS[value]) {
        return { personaKey: value, personaId: null };
    }
    if (mongoose.Types.ObjectId.isValid(value)) {
        const persona = await Persona.findOne({ _id: value, user: userId }).lean();
        if (persona) return { personaKey: null, personaId: persona._id };
    }
    return "invalid";
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

// Get User Chats — pinned first, then newest
exports.getUserChats = async (req, res) => {
    try {
        const chats = await Chat.find({ user: req.user._id }).sort({ pinned: -1, createdAt: -1 });
        res.status(200).json({ chats });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// Create/Update Chat (Message) — non-streaming path (unchanged response shape)
exports.sendMessage = async (req, res) => {
    let degradedChat = null, degradedSources = null, degradedMemories = null;
    try {
        if (!process.env.GEMINI_API_KEY && process.env.GEMINI_MOCK !== "1") {
            throw new Error("GEMINI_API_KEY is missing in environment variables");
        }

        let { message, chatId, fileId, useDocuments, documentIds } = req.body;
        const userId = req.user._id;

        // Allow file-only messages (attach + send with no text)
        if ((!message || !message.trim()) && fileId) message = "Please analyze the attached file.";
        if (!message || !message.trim()) {
            return res.status(400).json({ message: "Message cannot be empty" });
        }
        message = message.trim();

        let chat;
        if (chatId) {
            chat = await Chat.findOne({ _id: chatId, user: userId });
        }

        let isNewChat = false;
        if (!chat) {
            chat = new Chat({
                user: userId,
                title: message.substring(0, 30) + (message.length > 30 ? "..." : ""),
                messages: [],
            });
            isNewChat = true;
        }

        // Add user message to DB
        chat.messages.push({ role: "user", content: message });

        const { prompt, sources, tempFileDoc, systemInstruction, rewrittenQuery, usedMemories, usedMemoryDetails, keywordOnly } =
            await prepareMessageContext(userId, chat, message, { useDocuments, documentIds, fileId, memoryEnabled: req.user.memoryEnabled !== false });
        degradedChat = chat;
        degradedSources = sources;
        degradedMemories = usedMemories;

        const history = buildHistory(chat);
        const result = await geminiHelper.generateChatWithRetry(history, prompt, 3, { systemInstruction });
        const responseText = geminiHelper.getText(result);

        chat.messages.push({
            role: "model",
            content: responseText,
            sources: sources.length ? sources : undefined,
            rewrittenQuery,
            usedMemories: usedMemories.length ? usedMemories : undefined,
            provider: result.provider,
            model: result.model,
        });

        await chat.save();
        if (isNewChat) autoTitle(chat);
        require("../utils/memory").markUsed(usedMemories);
        afterAssistantReply(chat, req.user);
        res.status(200).json({
            response: responseText, chatId: chat._id, chat,
            sources: sources.length ? sources : undefined,
            rewrittenQuery,
            usedMemories: usedMemories.length ? usedMemories : undefined,
            usedMemoryDetails: usedMemoryDetails.length ? usedMemoryDetails : undefined,
            provider: result.provider,
            model: result.model,
            keywordOnly: keywordOnly || undefined,
        });

        // Temp attachments are single-use: drop the record + disk file afterwards
        if (tempFileDoc) removeFileArtifacts(tempFileDoc);
    } catch (err) {
        const cls = require("../utils/geminiHelper").classifyError(err);
        // Extractive fallback: every provider down/quota + retrieved sources
        // → answer with the passages, flagged degraded. Never an empty 500.
        if ((cls.kind === "daily-quota" || cls.kind === "no-providers") && degradedSources?.length) {
            const reply = require("../utils/extractive").buildExtractiveReply(degradedSources);
            if (reply && degradedChat) {
                try {
                    degradedChat.messages.push({
                        role: "model", content: reply,
                        sources: degradedSources,
                        degraded: true,
                        usedMemories: degradedMemories?.length ? degradedMemories : undefined,
                    });
                    await degradedChat.save();
                } catch (e) { logger.warn({ err: e.message }, "[Chat] degraded persist failed"); }
            }
            if (reply) {
                return res.status(200).json({
                    response: reply, chatId: degradedChat?._id, chat: degradedChat,
                    sources: degradedSources, degraded: true,
                });
            }
        }
        if (cls.kind === "daily-quota") {
            return res.status(429).json({
                message: "The daily AI quota has been reached — please try again later.",
                code: cls.code,
                retryAfterMs: cls.retryAfterMs,
            });
        }
        logger.error({ err: err.message }, "CHAT_ERROR_DETAILS");
        res.status(500).json({
            message: "Chat Error",
            error: err.message,
            details: err.toString()
        });
    }
};

// Streaming chat — same inputs/ownership/RAG options as sendMessage, SSE out.
// Events: data: {"type":"meta"|"token"|"done"|"error", ...}\n\n
exports.streamMessage = async (req, res) => {
    const userId = req.user._id;
    let chat = null;
    let sources = [];
    let rewrittenQuery;
    let usedMemories = [];
    let usedMemoryDetails = [];
    let finished = false;
    let aborted = false;
    let accumulated = "";
    let agentTrace = null;
    let answerProvider = null;
    let answerModel = null;
    let degradedReply = false;
    const pendingToolCalls = new Map();
    let ping = null;
    const abort = new AbortController();
    const cleanup = () => { if (ping) clearInterval(ping); ping = null; };

    const sseHeaders = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
    };

    const sendEvent = (obj) => {
        // Trace tool activity as events stream by — survives abort mid-run
        if (obj.type === "tool_call") pendingToolCalls.set(obj.id, obj);
        if (obj.type === "tool_result") {
            agentTrace = agentTrace || [];
            const [step, tool] = String(obj.id).split(":");
            const call = pendingToolCalls.get(obj.id);
            agentTrace.push({
                step: Number(step) || undefined,
                tool,
                argsPreview: call?.argsPreview,
                ok: obj.ok,
                ms: obj.ms,
                summary: obj.summary,
            });
        }
        if (res.writableEnded) return;
        try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { /* socket gone */ }
    };

    /** Persist the (possibly partial) assistant message. Idempotent via `finished`. */
    const persistAssistant = async (truncated) => {
        if (!chat) return;
        try {
            chat.messages.push({
                role: "model",
                content: accumulated || "(response stopped before any output)",
                sources: sources.length ? sources : undefined,
                trace: agentTrace?.length ? agentTrace : undefined,
                truncated: !!truncated,
                degraded: degradedReply || undefined,
                provider: answerProvider,
                model: answerModel,
                rewrittenQuery,
                usedMemories: usedMemories.length ? usedMemories : undefined,
            });
            await chat.save();
            require("../utils/memory").markUsed(usedMemories);
            afterAssistantReply(chat, req.user);
        } catch (e) {
            logger.error({ err: e.message }, "[Chat][stream] failed to persist assistant message");
        }
    };

    try {
        if (!process.env.GEMINI_API_KEY && process.env.GEMINI_MOCK !== "1") {
            return res.status(500).json({ message: "GEMINI_API_KEY is missing" });
        }

        let { message, fileId, useDocuments, documentIds, mode, browse } = req.body;
        const isAgent = mode === "agent";
        if (isAgent && process.env.FEATURE_AGENT === "false") {
            return res.status(400).json({ message: "Agent mode is disabled on this deployment" });
        }
        const chatIdParam = req.params.chatId === "new" ? null : req.params.chatId;

        if ((!message || !message.trim()) && fileId) message = "Please analyze the attached file.";
        if (!message || !message.trim()) {
            return res.status(400).json({ message: "Message cannot be empty" });
        }
        message = message.trim();

        if (chatIdParam) {
            chat = await Chat.findOne({ _id: chatIdParam, user: userId });
            if (!chat) return res.status(404).json({ message: "Chat not found" });
        } else {
            chat = new Chat({
                user: userId,
                title: message.substring(0, 30) + (message.length > 30 ? "..." : ""),
                messages: [],
            });
        }
        const isNewChat = chat.isNew;

        chat.messages.push({ role: "user", content: message });
        // Agent mode does its own retrieval via tools — skip the auto-RAG pass
        const ctx = await prepareMessageContext(userId, chat, message, {
            useDocuments: isAgent ? false : useDocuments,
            documentIds,
            fileId,
            memoryEnabled: req.user.memoryEnabled !== false,
        });
        sources = ctx.sources;
        rewrittenQuery = ctx.rewrittenQuery;
        usedMemories = ctx.usedMemories;
        usedMemoryDetails = ctx.usedMemoryDetails;
        await chat.save(); // persist user turn before streaming starts

        // --- SSE begins ---
        res.writeHead(200, sseHeaders);
        res.flushHeaders();
        require("../utils/sseRegistry").register(res);
        ping = setInterval(() => {
            if (!res.writableEnded) res.write(": ping\n\n");
        }, 15000);

        sendEvent({ type: "meta", chatId: chat._id, requestId: getRequestId(), sources: sources.length ? sources : undefined, rewrittenQuery, usedMemories: usedMemories.length ? usedMemories : undefined, usedMemoryDetails: usedMemoryDetails.length ? usedMemoryDetails : undefined, keywordOnly: ctx.keywordOnly || undefined });

        // Client disconnect mid-stream: res 'close' fires when the socket is
        // gone (more reliable than req 'close' for aborted responses).
        res.on("close", () => {
            if (finished) return;
            aborted = true;
            abort.abort();
            logger.info({ chatId: String(chat._id) }, "[Chat][stream] client disconnected — persisting partial");
            persistAssistant(true).finally(cleanup);
        });

        const history = buildHistory(chat);
        let usage = null;

        if (isAgent) {
            const { runAgent } = require("../services/agent");
            const personaPrompt = await resolvePersonaPrompt(chat);
            // Degraded agent mode (Phase 6B): no tool-capable provider →
            // friendly refusal + whatever cheap non-AI context exists.
            const degradedAgentReply = async () => {
                let docList = "";
                try {
                    const list = await require("../tools").execute("list_documents", {}, { userId, chatId: chat._id });
                    const names = (list?.raw?.documents || []).slice(0, 20).map((d) => `- ${d.name || d.originalName || "document"}`);
                    if (names.length) docList = `\n\nYour documents:\n${names.join("\n")}`;
                } catch { /* listing is best-effort */ }
                const msg = "AI is unavailable right now, so agent mode can't run tools or reason over your documents." + docList;
                accumulated = msg;
                degradedReply = true;
                for (const piece of msg.match(/\S+\s*/g) || []) sendEvent({ type: "token", text: piece });
                finished = true;
                await persistAssistant(false);
                sendEvent({ type: "done", chatId: chat._id, messageId: chat.messages[chat.messages.length - 1]?._id, truncated: false, degraded: true });
                cleanup();
                res.end();
            };
            if (!require("../utils/llm").generationAvailable("agent")) {
                await degradedAgentReply();
                return;
            }
            let outcome;
            try {
                outcome = await runAgent({
                    userId,
                    chatId: chat._id,
                    message,
                    history,
                    personaPrompt,
                    memoryBlock: ctx.memoryBlock,
                    browse: !!browse,
                    emit: sendEvent,
                    signal: abort.signal,
                });
            } catch (agentErr) {
                const acls = require("../utils/geminiHelper").classifyError(agentErr);
                if (acls.kind === "no-providers" || acls.kind === "daily-quota") {
                    await degradedAgentReply();
                    return;
                }
                throw agentErr;
            }
            sources = [...outcome.sources, ...outcome.webSources];
            accumulated = outcome.text || "";
            usage = outcome.usage;
            // Emit the final answer as token events — same SSE contract as chat
            if (!aborted) {
                for (const piece of accumulated.match(/\S+\s*/g) || []) {
                    sendEvent({ type: "token", text: piece });
                }
            }
            if (aborted) return;
            finished = true;
            await persistAssistant(false);
            if (isNewChat) autoTitle(chat);
            sendEvent({
                type: "done",
                chatId: chat._id,
                messageId: chat.messages[chat.messages.length - 1]?._id,
                truncated: false,
                usage: usage || undefined,
                sources: sources.length ? sources : undefined,
            });
            cleanup();
            res.end();
            if (ctx.tempFileDoc) removeFileArtifacts(ctx.tempFileDoc);
            return;
        }

        const stream = await geminiHelper.generateChatStream(history, ctx.prompt, { systemInstruction: ctx.systemInstruction }, abort.signal);

        for await (const chunk of stream) {
            if (aborted) break;
            if (chunk?.provider) answerProvider = chunk.provider;
            if (chunk?.model) answerModel = chunk.model;
            const text = chunk?.text || "";
            if (chunk?.usageMetadata) usage = chunk.usageMetadata;
            if (text) {
                accumulated += text;
                sendEvent({ type: "token", text });
            }
        }

        // Abort path is handled by the req "close" listener (persist truncated)
        if (aborted) return;

        finished = true;
        await persistAssistant(false);
        if (isNewChat) autoTitle(chat);
        sendEvent({
            type: "done",
            chatId: chat._id,
            messageId: chat.messages[chat.messages.length - 1]?._id,
            truncated: false,
            usage: usage || undefined,
            provider: answerProvider || undefined,
            model: answerModel || undefined,
        });
        cleanup();
        res.end();

        if (ctx.tempFileDoc) removeFileArtifacts(ctx.tempFileDoc);
    } catch (err) {
        cleanup();
        const cls = require("../utils/geminiHelper").classifyError(err);
        logger.error({ err: err.message, errorCode: cls.code }, "[Chat][stream] error");
        if (aborted) return; // disconnect path already handled
        // Extractive fallback (Phase 6B): every answer-chain provider down or
        // daily-exhausted + retrieved sources → reply with the passages,
        // labelled and flagged degraded — never an empty error screen.
        if ((cls.kind === "daily-quota" || cls.kind === "no-providers") && sources.length && res.headersSent && !res.writableEnded) {
            const reply = require("../utils/extractive").buildExtractiveReply(sources);
            if (reply) {
                accumulated = reply;
                degradedReply = true;
                for (const piece of reply.match(/\S+\s*/g) || []) {
                    sendEvent({ type: "token", text: piece });
                }
                finished = true;
                await persistAssistant(false);
                sendEvent({
                    type: "done",
                    chatId: chat._id,
                    messageId: chat.messages[chat.messages.length - 1]?._id,
                    truncated: false,
                    degraded: true,
                });
                res.end();
                return;
            }
        }
        if (cls.kind === "daily-quota") {
            const payload = {
                code: cls.code,
                message: "The daily AI quota has been reached — please try again later.",
                retryAfterMs: cls.retryAfterMs,
            };
            if (res.headersSent && !res.writableEnded) {
                sendEvent({ type: "error", ...payload });
                res.end();
            } else if (!res.headersSent) {
                res.status(429).json(payload);
            }
            return;
        }
        if (res.headersSent && !res.writableEnded) {
            sendEvent({ type: "error", code: "GEN_FAILED", message: err.message });
            // Persist whatever partial output exists so history stays consistent
            if (accumulated) await persistAssistant(true);
            res.end();
        } else if (!res.headersSent) {
            res.status(500).json({ message: "Chat Error", error: err.message });
        }
    }
};

// Get specific chat messages
exports.getChatMessages = async (req, res) => {
    try {
        const { chatId } = req.params;
        const chat = await Chat.findOne({ _id: chatId, user: req.user._id });
        if (!chat) return res.status(404).json({ message: "Chat not found" });
        res.status(200).json({ chat });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// Update chat metadata: { title?, pinned?, tags?, persona? } — owner-scoped
exports.updateChat = async (req, res) => {
    try {
        const { chatId } = req.params;
        const { title, pinned, tags, persona } = req.body;
        const update = {};

        if (title !== undefined) {
            if (typeof title !== "string" || !title.trim() || title.length > 120) {
                return res.status(400).json({ message: "Title must be a non-empty string up to 120 chars" });
            }
            update.title = title.trim();
        }
        if (pinned !== undefined) {
            if (typeof pinned !== "boolean") return res.status(400).json({ message: "pinned must be boolean" });
            update.pinned = pinned;
        }
        if (tags !== undefined) {
            if (!Array.isArray(tags) || tags.length > 8 || tags.some((t) => typeof t !== "string" || t.length > 30)) {
                return res.status(400).json({ message: "tags must be an array of up to 8 strings (<=30 chars each)" });
            }
            update.tags = tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
        }
        if (persona !== undefined) {
            const resolved = await resolvePersonaValue(req.user._id, persona);
            if (resolved === "invalid") return res.status(400).json({ message: "Unknown persona" });
            Object.assign(update, resolved);
        }
        if (Object.keys(update).length === 0) {
            return res.status(400).json({ message: "Nothing to update" });
        }

        const chat = await Chat.findOneAndUpdate(
            { _id: chatId, user: req.user._id },
            { $set: update },
            { new: true }
        );
        if (!chat) return res.status(404).json({ message: "Chat not found" });
        res.status(200).json({ chat });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// Delete Chat
exports.deleteChat = async (req, res) => {
    try {
        const { chatId } = req.params;
        const chat = await Chat.findOneAndDelete({ _id: chatId, user: req.user._id });
        if (!chat) return res.status(404).json({ message: "Chat not found" });
        res.status(200).json({ message: "Chat deleted" });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// Generate Mindmap from Chat
exports.generateMindmap = async (req, res) => {
    try {
        if (!process.env.GEMINI_API_KEY && process.env.GEMINI_MOCK !== "1") {
            throw new Error("GEMINI_API_KEY is missing");
        }

        const { chatId } = req.body;
        const chat = await Chat.findOne({ _id: chatId, user: req.user._id });
        if (!chat) return res.status(404).json({ message: "Chat not found" });

        // Combine messages for context
        const fullText = chat.messages.map(m => `${m.role}: ${m.content}`).join("\n");

        const prompt = `Based on the conversation, generate a visual Mermaid.js mindmap.
        Rules:
        1. Start with 'mindmap'
        2. Use Strict Indentation (2 spaces).
        3. Enclose ALL text in double quotes/parentheses like ("Text Here") to allow special characters.
        4. Keep it hierarchical and concise.
        
        Example:
        mindmap
          root((Central Topic))
            ("Sub Topic 1")
              ("Detail A")
            ("Sub Topic 2")
        
        Conversation:
        ${fullText}
        
        Return ONLY the mermaid code block.`;

        const result = await geminiHelper.generateContentWithRetry(prompt);
        const text = geminiHelper.getText(result);
        // Clean code block formatting if present
        const cleanCode = text.replace(/```mermaid/g, "").replace(/```/g, "").trim();

        res.status(200).json({ mindmap: cleanCode });
    } catch (err) {
        logger.error({ err: err.message }, "MINDMAP_ERROR");
        res.status(500).json({
            message: "Mindmap Generation Error",
            error: err.message,
            details: err.toString()
        });
    }
};
