/**
 * memoryController.js — /api/v1/memories CRUD + /api/v1/me/memory toggle.
 * Every query is owner-scoped. Writes that change text re-run the sensitive
 * filter and re-embed. Export is a plain data-portability JSON dump.
 */
const Memory = require("../models/Memory");
const User = require("../models/userModel");
const mem = require("../utils/memory");
const geminiHelper = require("../utils/geminiHelper");

const PAGE_MAX = 100;

// GET /api/v1/memories?page=&limit=
exports.list = async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page || "1", 10));
        const limit = Math.min(PAGE_MAX, Math.max(1, parseInt(req.query.limit || "50", 10)));
        const [items, total] = await Promise.all([
            Memory.find({ user: req.user._id })
                .select("-embedding")
                .sort({ updatedAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            Memory.countDocuments({ user: req.user._id }),
        ]);
        res.status(200).json({
            memories: items, total, page, limit,
            cap: mem.MAX,
            enabled: req.user.memoryEnabled !== false,
        });
    } catch {
        res.status(500).json({ message: "Memory query failed" });
    }
};

// GET /api/v1/memories/export — data portability (Phase 5.3)
exports.exportJson = async (req, res) => {
    try {
        const items = await Memory.find({ user: req.user._id })
            .select("text category createdAt updatedAt lastUsedAt useCount sourceChat")
            .sort({ createdAt: 1 })
            .lean();
        res.set("Content-Disposition", 'attachment; filename="quantum-memories.json"');
        res.status(200).json({ exportedAt: new Date().toISOString(), count: items.length, memories: items });
    } catch {
        res.status(500).json({ message: "Export failed" });
    }
};

// POST /api/v1/memories {text, category} — manual add, same validation + cap
exports.create = async (req, res) => {
    try {
        const item = mem.validateItem(req.body || {});
        if (!item) {
            return res.status(422).json({
                code: "MEMORY_REJECTED",
                message: "Memory rejected — too short, too long, or contains sensitive-looking content.",
            });
        }
        const count = await Memory.countDocuments({ user: req.user._id });
        if (count >= mem.MAX) {
            return res.status(409).json({ code: "MEMORY_CAP", message: `Memory is full (${mem.MAX}). Delete some first.` });
        }
        let embedding;
        try { embedding = await geminiHelper.getEmbedding(item.text, { task: "document" }); } catch { embedding = undefined; }
        const doc = await Memory.create({
            user: req.user._id, ...item, embedding,
            embeddingModel: geminiHelper.embeddingModel, embeddingDims: 768,
        });
        res.status(201).json({ memory: { _id: doc._id, text: doc.text, category: doc.category, createdAt: doc.createdAt } });
    } catch {
        res.status(500).json({ message: "Memory create failed" });
    }
};

// PATCH /api/v1/memories/:id {text?, category?} — re-embed + re-filter on text change
exports.update = async (req, res) => {
    try {
        const doc = await Memory.findOne({ _id: req.params.id, user: req.user._id });
        if (!doc) return res.status(404).json({ message: "Memory not found" });
        const { text, category } = req.body || {};
        if (text !== undefined) {
            const item = mem.validateItem({ text, category: category || doc.category });
            if (!item) {
                return res.status(422).json({
                    code: "MEMORY_REJECTED",
                    message: "Memory rejected — too short, too long, or contains sensitive-looking content.",
                });
            }
            doc.text = item.text;
            try { doc.embedding = await geminiHelper.getEmbedding(item.text, { task: "document" }); } catch { /* keep old */ }
        }
        if (category !== undefined) doc.category = mem.CATEGORIES.includes(category) ? category : doc.category;
        doc.updatedAt = new Date();
        await doc.save();
        res.status(200).json({ memory: { _id: doc._id, text: doc.text, category: doc.category, updatedAt: doc.updatedAt } });
    } catch {
        res.status(500).json({ message: "Memory update failed" });
    }
};

// DELETE /api/v1/memories/:id
exports.remove = async (req, res) => {
    try {
        const r = await Memory.deleteOne({ _id: req.params.id, user: req.user._id });
        if (!r.deletedCount) return res.status(404).json({ message: "Memory not found" });
        res.status(200).json({ success: true });
    } catch {
        res.status(500).json({ message: "Memory delete failed" });
    }
};

// DELETE /api/v1/memories — forget everything
exports.removeAll = async (req, res) => {
    try {
        const r = await Memory.deleteMany({ user: req.user._id });
        res.status(200).json({ success: true, deleted: r.deletedCount });
    } catch {
        res.status(500).json({ message: "Memory delete failed" });
    }
};

// PATCH /api/v1/me/memory {enabled} — global toggle
exports.setEnabled = async (req, res) => {
    try {
        const enabled = req.body?.enabled !== false;
        await User.updateOne({ _id: req.user._id }, { $set: { memoryEnabled: enabled } });
        res.status(200).json({ memoryEnabled: enabled });
    } catch {
        res.status(500).json({ message: "Update failed" });
    }
};

// POST /api/v1/me/memory/notice — mark the first-use notice as seen
exports.noticeSeen = async (req, res) => {
    try {
        await User.updateOne({ _id: req.user._id }, { $set: { memoryNoticeSeen: true } });
        res.status(200).json({ success: true });
    } catch {
        res.status(500).json({ message: "Update failed" });
    }
};
