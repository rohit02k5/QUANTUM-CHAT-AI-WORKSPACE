/**
 * apiKeyController.js — Phase 5.4 key management (JWT-authed) + the
 * Bearer-only public chat endpoint.
 */
const ApiKey = require("../models/ApiKey");
const User = require("../models/userModel");
const File = require("../models/File");
const UsageEvent = require("../models/UsageEvent");
const keys = require("../utils/apiKeys");
const guard = require("../utils/guard");
const { retrieveChunks } = require("../utils/retriever");
const geminiHelper = require("../utils/geminiHelper");
const { tryConsume } = require("../utils/aiQuota");
const logger = require("../utils/logger");

// ---------- Management (JWT) ----------

// POST /api/v1/keys {name} — plaintext shown ONCE
exports.create = async (req, res) => {
    try {
        const name = String(req.body?.name || "").trim().slice(0, 60) || "API key";
        const active = await ApiKey.countDocuments({ user: req.user._id, revokedAt: null });
        if (active >= keys.MAX_KEYS()) {
            return res.status(409).json({ code: "KEY_LIMIT", message: `Maximum ${keys.MAX_KEYS()} active keys — revoke one first.` });
        }
        const plaintext = keys.generateKey();
        const doc = await ApiKey.create({
            user: req.user._id, name,
            hash: keys.hashKey(plaintext),
            prefix: plaintext.slice(0, 8),
        });
        res.status(201).json({
            key: plaintext, // shown once — never stored, never logged
            apiKey: { _id: doc._id, name: doc.name, prefix: doc.prefix, createdAt: doc.createdAt },
        });
    } catch {
        res.status(500).json({ message: "Key create failed" });
    }
};

// GET /api/v1/keys
exports.list = async (req, res) => {
    try {
        const items = await ApiKey.find({ user: req.user._id })
            .select("name prefix lastUsedAt revokedAt createdAt")
            .sort({ createdAt: -1 }).lean();
        res.status(200).json({ keys: items });
    } catch {
        res.status(500).json({ message: "Key query failed" });
    }
};

// DELETE /api/v1/keys/:id — revoke (soft delete, keeps audit)
exports.revoke = async (req, res) => {
    try {
        const r = await ApiKey.updateOne(
            { _id: req.params.id, user: req.user._id, revokedAt: null },
            { $set: { revokedAt: new Date() } }
        );
        if (!r.modifiedCount) return res.status(404).json({ message: "Key not found" });
        res.status(200).json({ success: true });
    } catch {
        res.status(500).json({ message: "Key revoke failed" });
    }
};

// ---------- Public endpoint (Bearer only) ----------

const MSG_MAX = 2000;

/**
 * POST /api/v1/public/chat — non-streaming RAG over the key owner's READY
 * files. No agent, no memory, no tools, no web search, no uploads.
 */
exports.publicChat = async (req, res) => {
    const send401 = () => res.status(401).json({ code: "INVALID_API_KEY", message: "Invalid or revoked API key" });
    try {
        const auth = String(req.headers.authorization || "");
        const m = auth.match(/^Bearer\s+(.+)$/i);
        if (!m) return send401();
        const apiKey = await keys.resolveKey(m[1]);
        if (!apiKey) return send401();

        // Per-key limits — rate first (cheapest rejection)
        const rate = keys.checkRate(String(apiKey._id));
        if (!rate.allowed) {
            return res.status(429).json({ code: "API_KEY_RATE_LIMIT", message: "Rate limit: 30 requests per 15 minutes per key" });
        }
        const daily = keys.checkDaily(String(apiKey._id));
        if (!daily.allowed) {
            return res.status(429).json({ code: "API_KEY_DAILY_CAP", message: `Daily cap reached (${keys.DAILY_CAP()}/day per key)` });
        }

        const { message, fileIds, topK } = req.body || {};
        if (!message || typeof message !== "string" || !message.trim()) {
            return res.status(400).json({ code: "BAD_REQUEST", message: "message (string) is required" });
        }
        if (message.length > MSG_MAX) {
            return res.status(400).json({ code: "MESSAGE_TOO_LONG", message: `message must be ≤${MSG_MAX} chars` });
        }
        const k = Math.min(8, Math.max(1, parseInt(topK || "5", 10)));

        // Owner daily AI cap — the key's spend counts against its owner
        const owner = await User.findById(apiKey.user).select("email").lean();
        const consumed = await tryConsume(apiKey.user, owner?.email);
        if (!consumed.allowed) {
            return res.status(429).json({ code: "AI_USER_CAP_REACHED", message: "The key owner's daily AI limit is reached." });
        }

        keys.touchUsed(apiKey._id);

        // Scope to owner + READY files; client-supplied fileIds intersected
        // with ownership — never leak another user's files.
        const fileFilter = { user: apiKey.user, isTemp: { $ne: true }, status: "ready" };
        if (Array.isArray(fileIds) && fileIds.length) fileFilter._id = { $in: fileIds.slice(0, 20) };
        const owned = await File.find(fileFilter).select("_id originalName").lean();
        const scopedIds = owned.map((f) => f._id.toString());
        if (!scopedIds.length) {
            return res.status(200).json({ answer: "No indexed documents are available to this key.", sources: [], usage: null });
        }

        const chunks = await retrieveChunks(apiKey.user, message.trim(), k, scopedIds, { memoryEnabled: false });
        const { context } = guard.wrapSources(chunks);
        const systemInstruction = guard.buildSystemInstruction({});
        const prompt = guard.buildRagPrompt(message.trim(), context);

        const t0 = Date.now();
        const result = await geminiHelper.generateChatWithRetry([], prompt, 2, { systemInstruction });
        const answer = geminiHelper.getText(result);

        UsageEvent.create({
            user: apiKey.user, apiKeyId: apiKey._id, kind: "api", ok: true,
            latencyMs: Date.now() - t0, requestId: req.requestId,
        }).catch(() => {});

        res.status(200).json({
            answer,
            sources: chunks.map((c) => ({
                fileId: c.fileId?.toString(),
                name: c.originalName,
                page: c.metadata?.page,
                startSec: c.metadata?.startSec,
                snippet: (c.text || "").slice(0, 200),
            })),
            usage: { modelCalls: 1, dailyRemaining: daily.remaining },
        });
    } catch (e) {
        logger.warn({ err: e.message }, "[publicChat] failed");
        res.status(500).json({ message: "Public chat failed" });
    }
};
