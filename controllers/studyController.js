/**
 * studyController.js — /api/v1/study (Phase 5.2).
 * Decks/cards CRUD, SM-2 reviews, stats, and quiz generation/grading.
 * Every query is owner-scoped; quiz grading is purely server-side from the
 * stored snapshot — a client-sent score can never affect the result.
 */
const mongoose = require("mongoose");
const Deck = require("../models/Deck");
const Card = require("../models/Card");
const ReviewLog = require("../models/ReviewLog");
const QuizAttempt = require("../models/QuizAttempt");
const File = require("../models/File");
const sm2 = require("../services/sm2");
const geminiHelper = require("../utils/geminiHelper");
const guard = require("../utils/guard");
const { retrieveChunks } = require("../utils/retriever");
const logger = require("../utils/logger");

const CARD_CAP = () => parseInt(process.env.STUDY_MAX_CARDS || "2000", 10);
const QUIZ_MAX_Q = () => parseInt(process.env.QUIZ_MAX_Q || "10", 10);
const DOUBLE_SUBMIT_MS = 4000;

// ---------- Decks ----------

// GET /api/v1/study/decks — decks with due counts
exports.listDecks = async (req, res) => {
    try {
        const now = new Date();
        const decks = await Deck.find({ user: req.user._id }).sort({ createdAt: -1 }).lean();
        const counts = await Card.aggregate([
            { $match: { user: req.user._id } },
            { $group: { _id: "$deck", total: { $sum: 1 }, due: { $sum: { $cond: [{ $lte: ["$due", now] }, 1, 0] } } } },
        ]);
        const byDeck = new Map(counts.map((c) => [String(c._id), c]));
        res.status(200).json({
            decks: decks.map((d) => ({
                ...d,
                total: byDeck.get(String(d._id))?.total || 0,
                due: byDeck.get(String(d._id))?.due || 0,
            })),
        });
    } catch (e) {
        res.status(500).json({ message: "Deck query failed" });
    }
};

// POST /api/v1/study/decks {name, sourceFile?}
exports.createDeck = async (req, res) => {
    try {
        const name = String(req.body?.name || "").trim().slice(0, 120);
        if (!name) return res.status(400).json({ message: "Deck name required" });
        let sourceFile;
        if (req.body?.sourceFile) {
            const f = await File.findOne({ _id: req.body.sourceFile, user: req.user._id }).select("_id");
            if (!f) return res.status(404).json({ message: "Source file not found" });
            sourceFile = f._id;
        }
        const deck = await Deck.create({ user: req.user._id, name, sourceFile });
        res.status(201).json({ deck });
    } catch {
        res.status(500).json({ message: "Deck create failed" });
    }
};

// PATCH /api/v1/study/decks/:id {name}
exports.updateDeck = async (req, res) => {
    try {
        const name = String(req.body?.name || "").trim().slice(0, 120);
        if (!name) return res.status(400).json({ message: "Deck name required" });
        const deck = await Deck.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id },
            { $set: { name } },
            { new: true }
        );
        if (!deck) return res.status(404).json({ message: "Deck not found" });
        res.status(200).json({ deck });
    } catch {
        res.status(500).json({ message: "Deck update failed" });
    }
};

// DELETE /api/v1/study/decks/:id — cascades cards + review logs (deck-scoped)
exports.deleteDeck = async (req, res) => {
    try {
        const deck = await Deck.findOne({ _id: req.params.id, user: req.user._id });
        if (!deck) return res.status(404).json({ message: "Deck not found" });
        const [cards, logs] = await Promise.all([
            Card.deleteMany({ deck: deck._id, user: req.user._id }),
            ReviewLog.deleteMany({ deck: deck._id, user: req.user._id }),
        ]);
        await Deck.deleteOne({ _id: deck._id });
        res.status(200).json({ success: true, deletedCards: cards.deletedCount, deletedLogs: logs.deletedCount });
    } catch {
        res.status(500).json({ message: "Deck delete failed" });
    }
};

// ---------- Cards ----------

const insertCard = async (userId, deckId, front, back) => {
    const count = await Card.countDocuments({ user: userId });
    if (count >= CARD_CAP()) {
        const err = new Error(`Card limit reached (${CARD_CAP()})`);
        err.code = "STUDY_CARD_CAP";
        throw err;
    }
    return Card.create({ user: userId, deck: deckId, front: String(front).slice(0, 2000), back: String(back).slice(0, 4000) });
};

// POST /api/v1/study/decks/:id/cards {front, back} or {cards:[{front,back}]}
exports.addCards = async (req, res) => {
    try {
        const deck = await Deck.findOne({ _id: req.params.id, user: req.user._id }).select("_id");
        if (!deck) return res.status(404).json({ message: "Deck not found" });
        const inputs = Array.isArray(req.body?.cards)
            ? req.body.cards
            : [{ front: req.body?.front, back: req.body?.back }];
        const valid = inputs.filter((c) => c?.front?.trim() && c?.back?.trim()).slice(0, 50);
        if (!valid.length) return res.status(400).json({ message: "At least one {front, back} card is required" });
        const created = [];
        for (const c of valid) {
            try {
                created.push(await insertCard(req.user._id, deck._id, c.front, c.back));
            } catch (e) {
                if (e.code === "STUDY_CARD_CAP") {
                    return res.status(429).json({ code: e.code, message: e.message, created: created.length });
                }
                throw e;
            }
        }
        res.status(201).json({ created: created.length, cards: created });
    } catch {
        res.status(500).json({ message: "Card create failed" });
    }
};

// GET /api/v1/study/decks/:id/cards?q=&page=
exports.listCards = async (req, res) => {
    try {
        const deck = await Deck.findOne({ _id: req.params.id, user: req.user._id }).select("_id");
        if (!deck) return res.status(404).json({ message: "Deck not found" });
        const q = String(req.query.q || "").trim();
        const filter = { deck: deck._id, user: req.user._id };
        if (q) {
            const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 100);
            filter.$or = [{ front: { $regex: safe, $options: "i" } }, { back: { $regex: safe, $options: "i" } }];
        }
        const page = Math.max(1, parseInt(req.query.page || "1", 10));
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "50", 10)));
        const [cards, total] = await Promise.all([
            Card.find(filter).sort({ due: 1 }).skip((page - 1) * limit).limit(limit).lean(),
            Card.countDocuments(filter),
        ]);
        res.status(200).json({ cards, total, page, limit });
    } catch {
        res.status(500).json({ message: "Card query failed" });
    }
};

// DELETE /api/v1/study/cards/:id
exports.deleteCard = async (req, res) => {
    try {
        const r = await Card.deleteOne({ _id: req.params.id, user: req.user._id });
        if (!r.deletedCount) return res.status(404).json({ message: "Card not found" });
        await ReviewLog.deleteMany({ card: req.params.id, user: req.user._id });
        res.status(200).json({ success: true });
    } catch {
        res.status(500).json({ message: "Card delete failed" });
    }
};

// ---------- Review ----------

// GET /api/v1/study/due?deck=&limit=
exports.dueCards = async (req, res) => {
    try {
        const filter = { user: req.user._id, due: { $lte: new Date() } };
        if (req.query.deck) {
            const deck = await Deck.findOne({ _id: req.query.deck, user: req.user._id }).select("_id");
            if (!deck) return res.status(404).json({ message: "Deck not found" });
            filter.deck = deck._id;
        }
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "20", 10)));
        const cards = await Card.find(filter).sort({ due: 1 }).limit(limit).lean();
        res.status(200).json({ cards, count: cards.length });
    } catch {
        res.status(500).json({ message: "Due query failed" });
    }
};

// POST /api/v1/study/review {cardId, grade}
exports.review = async (req, res) => {
    try {
        const { cardId, grade } = req.body || {};
        const g = Number(grade);
        if (!mongoose.isValidObjectId(cardId)) return res.status(400).json({ message: "cardId required" });
        if (!Number.isInteger(g) || g < 0 || g > 5) {
            return res.status(422).json({ code: "INVALID_GRADE", message: "grade must be an integer 0-5" });
        }
        const card = await Card.findOne({ _id: cardId, user: req.user._id });
        if (!card) return res.status(404).json({ message: "Card not found" });

        // Idempotency guard: a double-submit within a few seconds replays the
        // last result instead of scheduling twice.
        const now = new Date();
        if (card.lastReviewedAt && now - card.lastReviewedAt < DOUBLE_SUBMIT_MS) {
            return res.status(200).json({
                card, idempotent: true,
                message: "Review already recorded",
            });
        }

        const next = sm2.schedule(card, g, now);
        await ReviewLog.create({
            user: req.user._id, card: card._id, deck: card.deck, grade: g,
            prevIntervalDays: card.intervalDays, newIntervalDays: next.intervalDays,
            prevEase: card.ease, newEase: next.ease,
            reviewedAt: now,
        });
        Object.assign(card, next, { lastReviewedAt: now });
        await card.save();
        res.status(200).json({ card });
    } catch (e) {
        logger.warn({ err: e.message }, "[Study] review failed");
        res.status(500).json({ message: "Review failed" });
    }
};

// ---------- Stats ----------

const IANA_OK = (tz) => {
    if (!tz || typeof tz !== "string") return false;
    try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
};

// GET /api/v1/study/stats?tz=Area/Name — due today, 7-day forecast, streak,
// retention (grade>=3 over 30d), totals, maturity buckets.
exports.stats = async (req, res) => {
    try {
        const tz = IANA_OK(req.query.tz) ? req.query.tz
            : IANA_OK(req.headers["x-timezone"]) ? req.headers["x-timezone"] : "UTC";
        const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz });
        const dayKey = (d) => dayFmt.format(d);
        const now = new Date();

        const cards = await Card.find({ user: req.user._id }).select("due intervalDays reps lapses").lean();
        const dueToday = cards.filter((c) => c.due <= now || dayKey(c.due) === dayKey(now)).length;
        const forecast = [];
        for (let i = 0; i < 7; i++) {
            const dayEnd = new Date(now.getTime() + (i + 1) * 86400000);
            const key = dayKey(dayEnd);
            forecast.push({ day: key, due: cards.filter((c) => dayKey(c.due) === key).length });
        }

        // Retention: fraction of reviews with grade >= 3 over the last 30 days
        const since = new Date(now.getTime() - 30 * 86400000);
        const logs = await ReviewLog.find({ user: req.user._id, reviewedAt: { $gte: since } })
            .select("grade reviewedAt").lean();
        const retention = logs.length ? logs.filter((l) => l.grade >= 3).length / logs.length : null;

        // Streak: consecutive days (in user tz) ending today/yesterday with >=1 review
        const days = new Set(logs.map((l) => dayKey(l.reviewedAt)));
        let streak = 0;
        const cursor = new Date(now);
        if (!days.has(dayKey(cursor))) cursor.setTime(cursor.getTime() - 86400000); // grace: today not done yet
        while (days.has(dayKey(cursor))) {
            streak++;
            cursor.setTime(cursor.getTime() - 86400000);
        }

        // Maturity buckets: new (reps 0), learning (interval<7), young (<21), mature (>=21)
        const buckets = { new: 0, learning: 0, young: 0, mature: 0 };
        for (const c of cards) {
            if (c.reps === 0) buckets.new++;
            else if (c.intervalDays < 7) buckets.learning++;
            else if (c.intervalDays < 21) buckets.young++;
            else buckets.mature++;
        }

        res.status(200).json({
            dueToday, forecast, streak, retention,
            reviews30d: logs.length,
            totalCards: cards.length,
            buckets, timezone: tz,
        });
    } catch (e) {
        logger.warn({ err: e.message }, "[Study] stats failed");
        res.status(500).json({ message: "Stats failed" });
    }
};

// ---------- Quiz ----------

const QUIZ_SCHEMA = {
    type: "array",
    items: {
        type: "object",
        properties: {
            q: { type: "string" },
            options: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 4 },
            correctIndex: { type: "integer", minimum: 0, maximum: 3 },
            explanation: { type: "string" },
        },
        required: ["q", "options", "correctIndex", "explanation"],
    },
};

/** Server-side validation of model-produced MCQs (spec: 4 opts, index in range, no dupes). */
function validQuestions(items) {
    if (!Array.isArray(items)) return [];
    return items.filter((it) =>
        it && typeof it.q === "string" && it.q.trim().length >= 8 &&
        Array.isArray(it.options) && it.options.length === 4 &&
        it.options.every((o) => typeof o === "string" && o.trim()) &&
        new Set(it.options.map((o) => o.trim().toLowerCase())).size === 4 &&
        Number.isInteger(it.correctIndex) && it.correctIndex >= 0 && it.correctIndex < 4 &&
        typeof it.explanation === "string"
    ).map((it) => ({
        q: it.q.trim().slice(0, 1000),
        options: it.options.map((o) => o.trim().slice(0, 500)),
        correctIndex: it.correctIndex,
        explanation: it.explanation.slice(0, 1000),
    }));
}

// POST /api/v1/study/quiz {fileId|deckId, count<=10}
exports.generateQuiz = async (req, res) => {
    try {
        const { fileId, deckId } = req.body || {};
        const count = Math.min(QUIZ_MAX_Q(), Math.max(1, parseInt(req.body?.count || "5", 10)));
        if (!fileId && !deckId) return res.status(400).json({ message: "fileId or deckId required" });
        // Daily-cap unit is consumed by the route's dailyAiCap middleware.

        let sourceText = "";
        let sourceFile, deck;
        if (fileId) {
            const file = await File.findOne({ _id: fileId, user: req.user._id });
            if (!file) return res.status(404).json({ message: "File not found" });
            if (file.status && file.status !== "ready") return res.status(409).json({ message: `File is ${file.status}` });
            sourceFile = file._id;
            // Prefer chunk retrieval (what the retriever sees) over raw content
            const chunks = await retrieveChunks(req.user._id, "key concepts, definitions and facts", 6, [file._id.toString()]).catch(() => []);
            sourceText = chunks.length
                ? chunks.map((c) => c.text).join("\n\n")
                : (file.content || "").slice(0, 12000);
        } else {
            deck = await Deck.findOne({ _id: deckId, user: req.user._id });
            if (!deck) return res.status(404).json({ message: "Deck not found" });
            const cards = await Card.find({ deck: deck._id, user: req.user._id }).limit(30).lean();
            if (!cards.length) return res.status(400).json({ message: "Deck has no cards to quiz from" });
            sourceText = cards.map((c) => `Q: ${c.front}\nA: ${c.back}`).join("\n\n");
        }

        // Source text is untrusted — wrap + neutralize before prompting.
        const wrapped = guard.wrapAttachment("quiz-source", sourceText.slice(0, 12000));
        const prompt =
            `Create exactly ${count} multiple-choice questions from the study material below. ` +
            "Each must have exactly 4 plausible options, one unambiguously correct answer " +
            "supported by the material, and a one-sentence explanation citing the material.\n\n" + wrapped;

        const result = await geminiHelper.generateCheapest(prompt, {
            responseMimeType: "application/json",
            responseSchema: QUIZ_SCHEMA,
        }, "quiz");
        let parsed;
        try { parsed = JSON.parse(geminiHelper.getText(result)); } catch { parsed = null; }
        const questions = validQuestions(parsed).slice(0, count);
        if (!questions.length) {
            return res.status(502).json({ code: "QUIZ_INVALID", message: "Quiz generation produced no valid questions — try again." });
        }

        const attempt = await QuizAttempt.create({
            user: req.user._id, deck: deck?._id, sourceFile,
            questions, total: questions.length,
        });
        // Strip correct answers + explanations from the client copy
        res.status(201).json({
            quizId: attempt._id,
            questions: questions.map(({ q, options }) => ({ q, options })),
        });
    } catch (e) {
        logger.warn({ err: e.message }, "[Study] quiz generation failed");
        res.status(500).json({ message: "Quiz generation failed" });
    }
};

// POST /api/v1/study/quiz/:id/submit {answers:[index]}
exports.submitQuiz = async (req, res) => {
    try {
        const attempt = await QuizAttempt.findOne({ _id: req.params.id, user: req.user._id });
        if (!attempt) return res.status(404).json({ message: "Quiz not found" });
        if (attempt.submittedAt) {
            return res.status(200).json({ quizId: attempt._id, score: attempt.score, total: attempt.total, results: publicResults(attempt), alreadySubmitted: true });
        }
        const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
        let score = 0;
        attempt.questions.forEach((q, i) => {
            const chosen = Number.isInteger(answers[i]) ? answers[i] : null;
            q.chosenIndex = chosen;
            if (chosen === q.correctIndex) score++;
        });
        attempt.score = score;
        attempt.submittedAt = new Date();
        await attempt.save();
        res.status(200).json({ quizId: attempt._id, score, total: attempt.total, results: publicResults(attempt) });
    } catch {
        res.status(500).json({ message: "Quiz submit failed" });
    }
};

const publicResults = (attempt) => attempt.questions.map((q) => ({
    q: q.q, options: q.options, correctIndex: q.correctIndex,
    chosenIndex: q.chosenIndex, explanation: q.explanation,
    correct: q.chosenIndex === q.correctIndex,
}));

// GET /api/v1/study/quiz/:id — review a completed attempt
exports.getQuiz = async (req, res) => {
    try {
        const attempt = await QuizAttempt.findOne({ _id: req.params.id, user: req.user._id }).lean();
        if (!attempt) return res.status(404).json({ message: "Quiz not found" });
        if (!attempt.submittedAt) {
            return res.status(200).json({
                quizId: attempt._id, submitted: false,
                questions: attempt.questions.map(({ q, options }) => ({ q, options })),
            });
        }
        res.status(200).json({ quizId: attempt._id, submitted: true, score: attempt.score, total: attempt.total, results: publicResults(attempt) });
    } catch {
        res.status(500).json({ message: "Quiz query failed" });
    }
};

exports._internal = { validQuestions, insertCard, QUIZ_SCHEMA };
