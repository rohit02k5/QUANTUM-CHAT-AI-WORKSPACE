/**
 * exportController.js — Phase 5.3 authenticated exports.
 * Chat → Markdown, Cards → CSV (BOM + formula-injection guard), all
 * owner-scoped with Content-Disposition attachment filenames. No public
 * share links — auth required by the mounted router.
 */
const Chat = require("../models/Chat");
const Card = require("../models/Card");
const Deck = require("../models/Deck");
const { chatToMarkdown, cardsToCsv } = require("../utils/exporters");

const filename = (name, ext) =>
    `attachment; filename="${String(name).replace(/[^\w.-]+/g, "-").slice(0, 60) || "export"}.${ext}"`;

// GET /api/v1/export/chat/:chatId — Markdown transcript w/ citation footnotes
exports.chatMd = async (req, res) => {
    try {
        const chat = await Chat.findOne({ _id: req.params.chatId, user: req.user._id }).lean();
        if (!chat) return res.status(404).json({ message: "Chat not found" });
        res.set({
            "Content-Type": "text/markdown; charset=utf-8",
            "Content-Disposition": filename(chat.title || "chat", "md"),
        });
        res.send(chatToMarkdown(chat));
    } catch {
        res.status(500).json({ message: "Export failed" });
    }
};

// GET /api/v1/export/cards.csv?deck=<id>&escape=0
// escape=0 disables the formula-injection apostrophe (for Anki imports, where
// a leading ' would leak into the card text). Documented in the UI + README.
exports.cardsCsv = async (req, res) => {
    try {
        const filter = { user: req.user._id };
        if (req.query.deck) {
            const deck = await Deck.findOne({ _id: req.query.deck, user: req.user._id }).select("_id name");
            if (!deck) return res.status(404).json({ message: "Deck not found" });
            filter.deck = deck._id;
        }
        const [cards, decks] = await Promise.all([
            Card.find(filter).sort({ deck: 1, createdAt: 1 }).limit(10000).lean(),
            Deck.find({ user: req.user._id }).select("_id name").lean(),
        ]);
        const nameByDeck = new Map(decks.map((d) => [String(d._id), d.name]));
        const rows = cards.map((c) => ({ ...c, deckName: nameByDeck.get(String(c.deck)) || "" }));
        const escapeFormula = req.query.escape !== "0";
        res.set({
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": filename("quantum-flashcards", "csv"),
        });
        // UTF-8 BOM so Excel/Sheets open the file with correct encoding
        res.send("﻿" + cardsToCsv(rows, { escapeFormula }));
    } catch {
        res.status(500).json({ message: "Export failed" });
    }
};
