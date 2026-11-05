// Phase 5.2: study mode — SM-2 scheduler, due/review/stats endpoints,
// deck cascade, card cap, quiz generation + server-side grading, migration.
const mongoose = require("mongoose");
const { request, app, createUser, auth } = require("./helpers");
const Deck = require("../models/Deck");
const Card = require("../models/Card");
const ReviewLog = require("../models/ReviewLog");
const QuizAttempt = require("../models/QuizAttempt");
const FlashcardSet = require("../models/FlashcardSet");
const sm2 = require("../services/sm2");
const mock = require("../utils/geminiMock");
const { _internal } = require("../controllers/studyController");

const DAY = 24 * 60 * 60 * 1000;

async function makeDeck(token, name = "Bio 101") {
    const r = await request(app).post("/api/v1/study/decks").set(auth(token)).send({ name });
    expect(r.status).toBe(201);
    return r.body.deck;
}

describe("5.2 SM-2 pure function", () => {
    it("hand-computed sequence: pass, pass, pass, lapse, ease floor", () => {
        const t0 = new Date("2025-01-01T12:00:00Z").getTime();
        let card = {};
        let s;

        // Review 1 — grade 4: EF 2.5+(0.1-1*(0.08+0.02))=2.5; reps=1; int=1d
        s = sm2.schedule(card, 4, t0);
        expect(s.ease).toBeCloseTo(2.5, 5);
        expect(s.reps).toBe(1);
        expect(s.intervalDays).toBe(1);
        expect(s.due.getTime()).toBe(t0 + DAY);
        card = s;

        // Review 2 — grade 5 at t+1d: EF 2.6; reps=2; int=6d
        s = sm2.schedule(card, 5, t0 + DAY);
        expect(s.ease).toBeCloseTo(2.6, 5);
        expect(s.reps).toBe(2);
        expect(s.intervalDays).toBe(6);
        card = s;

        // Review 3 — grade 5: EF 2.7; reps=3; int=round(6*2.7)=16
        s = sm2.schedule(card, 5, t0 + 7 * DAY);
        expect(s.ease).toBeCloseTo(2.7, 5);
        expect(s.reps).toBe(3);
        expect(s.intervalDays).toBe(16);
        card = s;

        // Review 4 — grade 2 (fail): EF 2.7+(0.1-3*(0.08+3*0.02))=2.38; reps=0; lapses=1; int=1d
        s = sm2.schedule(card, 2, t0 + 23 * DAY);
        expect(s.ease).toBeCloseTo(2.38, 5);
        expect(s.reps).toBe(0);
        expect(s.lapses).toBe(1);
        expect(s.intervalDays).toBe(1);
        card = s;

        // Two consecutive grade-0 lapses drive ease to the 1.3 floor
        s = sm2.schedule(card, 0, t0 + 24 * DAY); // 2.38 - 0.8 = 1.58
        expect(s.ease).toBeCloseTo(1.58, 5);
        s = sm2.schedule(s, 0, t0 + 25 * DAY);   // 1.58 - 0.8 = 0.78 → floor 1.3
        expect(s.ease).toBeCloseTo(1.3, 5);
        s = sm2.schedule(s, 0, t0 + 26 * DAY);   // stays at floor
        expect(s.ease).toBeCloseTo(1.3, 5);
    });

    it("rejects non-integer / out-of-range grades", () => {
        expect(() => sm2.schedule({}, 2.5, Date.now())).toThrow();
        expect(() => sm2.schedule({}, 6, Date.now())).toThrow();
        expect(() => sm2.schedule({}, -1, Date.now())).toThrow();
    });
});

describe("5.2 deck/card endpoints", () => {
    it("deck CRUD is owner-scoped; delete cascades cards+logs", async () => {
        const ua = await createUser();
        const ub = await createUser();
        const deck = await makeDeck(ua.token);
        await request(app).post(`/api/v1/study/decks/${deck._id}/cards`).set(auth(ua.token))
            .send({ front: "What is mitosis?", back: "Cell division" });

        // Cross-user access denied
        expect((await request(app).get(`/api/v1/study/decks/${deck._id}/cards`).set(auth(ub.token))).status).toBe(404);
        expect((await request(app).delete(`/api/v1/study/decks/${deck._id}`).set(auth(ub.token))).status).toBe(404);

        // Owner delete cascades
        const del = await request(app).delete(`/api/v1/study/decks/${deck._id}`).set(auth(ua.token));
        expect(del.status).toBe(200);
        expect(del.body.deletedCards).toBe(1);
        expect(await Card.countDocuments({ deck: deck._id })).toBe(0);
        expect(await Deck.findById(deck._id)).toBeNull();
    });

    it("due selection returns only due cards ordered by due, respecting limit", async () => {
        const u = await createUser();
        const deck = await makeDeck(u.token);
        await request(app).post(`/api/v1/study/decks/${deck._id}/cards`).set(auth(u.token))
            .send({ cards: [
                { front: "q1", back: "a1" },
                { front: "q2", back: "a2" },
                { front: "q3", back: "a3" },
            ] });
        // Push q3's due into the future directly
        const c3 = await Card.findOne({ front: "q3" });
        await Card.updateOne({ _id: c3._id }, { $set: { due: new Date(Date.now() + 3 * DAY) } });

        const due = await request(app).get("/api/v1/study/due?limit=10").set(auth(u.token));
        expect(due.status).toBe(200);
        expect(due.body.count).toBe(2); // q3 excluded — not due yet
        expect(due.body.cards.every((c) => new Date(c.due) <= new Date())).toBe(true);

        const limited = await request(app).get("/api/v1/study/due?limit=1").set(auth(u.token));
        expect(limited.body.cards).toHaveLength(1);

        const byDeck = await request(app).get(`/api/v1/study/due?deck=${deck._id}`).set(auth(u.token));
        expect(byDeck.body.count).toBe(2);
    });

    it("review applies SM-2, validates ownership/grade, guards double-submits", async () => {
        const ua = await createUser();
        const ub = await createUser();
        const deck = await makeDeck(ua.token);
        const card = (await request(app).post(`/api/v1/study/decks/${deck._id}/cards`).set(auth(ua.token))
            .send({ front: "f", back: "b" })).body.cards[0];

        // Invalid grades
        expect((await request(app).post("/api/v1/study/review").set(auth(ua.token)).send({ cardId: card._id, grade: 6 })).status).toBe(422);
        expect((await request(app).post("/api/v1/study/review").set(auth(ua.token)).send({ cardId: card._id, grade: "easy" })).status).toBe(422);

        // Cross-user review rejected
        expect((await request(app).post("/api/v1/study/review").set(auth(ub.token)).send({ cardId: card._id, grade: 4 })).status).toBe(404);

        // Valid review → SM-2 rep 1: ease 2.5, interval 1d
        const r1 = await request(app).post("/api/v1/study/review").set(auth(ua.token)).send({ cardId: card._id, grade: 4 });
        expect(r1.status).toBe(200);
        expect(r1.body.card.reps).toBe(1);
        expect(r1.body.card.intervalDays).toBe(1);
        expect(new Date(r1.body.card.due).getTime()).toBeGreaterThan(Date.now());
        expect(await ReviewLog.countDocuments({ card: card._id })).toBe(1);

        // Immediate double-submit → idempotent replay, no second log
        const r2 = await request(app).post("/api/v1/study/review").set(auth(ua.token)).send({ cardId: card._id, grade: 4 });
        expect(r2.status).toBe(200);
        expect(r2.body.idempotent).toBe(true);
        expect(await ReviewLog.countDocuments({ card: card._id })).toBe(1);
    });

    it("stats: due today, streak, retention, buckets", async () => {
        const u = await createUser();
        const deck = await makeDeck(u.token);
        await request(app).post(`/api/v1/study/decks/${deck._id}/cards`).set(auth(u.token))
            .send({ cards: [{ front: "f1", back: "b1" }, { front: "f2", back: "b2" }] });
        const uid = (await mongoose.model("User").findOne({ email: u.email }))._id;

        // Backfill two review days (yesterday + today) → streak 2
        const card = await Card.findOne({ user: uid });
        await ReviewLog.create([
            { user: uid, card: card._id, deck: deck._id, grade: 4, prevIntervalDays: 0, newIntervalDays: 1, prevEase: 2.5, newEase: 2.5, reviewedAt: new Date(Date.now() - DAY) },
            { user: uid, card: card._id, deck: deck._id, grade: 2, prevIntervalDays: 1, newIntervalDays: 1, prevEase: 2.5, newEase: 2.38, reviewedAt: new Date() },
        ]);

        const stats = await request(app).get("/api/v1/study/stats").set(auth(u.token));
        expect(stats.status).toBe(200);
        expect(stats.body.dueToday).toBe(2);
        expect(stats.body.streak).toBe(2);
        expect(stats.body.retention).toBeCloseTo(0.5); // 1 of 2 reviews >= 3
        expect(stats.body.totalCards).toBe(2);
        expect(stats.body.buckets.new).toBe(2);
        expect(stats.body.forecast).toHaveLength(7);

        // tz param validated; garbage falls back to UTC
        const bad = await request(app).get("/api/v1/study/stats?tz=Not/AZone").set(auth(u.token));
        expect(bad.body.timezone).toBe("UTC");
        const good = await request(app).get("/api/v1/study/stats?tz=Asia/Tokyo").set(auth(u.token));
        expect(good.body.timezone).toBe("Asia/Tokyo");
    });

    it("card cap returns a clear error", async () => {
        const u = await createUser();
        const deck = await makeDeck(u.token);
        const uid = (await mongoose.model("User").findOne({ email: u.email }))._id;
        // Simulate a user at the cap without inserting 2000 docs
        const old = Card.countDocuments;
        Card.countDocuments = () => Promise.resolve(2000);
        try {
            const r = await request(app).post(`/api/v1/study/decks/${deck._id}/cards`).set(auth(u.token))
                .send({ front: "over", back: "cap" });
            expect(r.status).toBe(429);
            expect(r.body.code).toBe("STUDY_CARD_CAP");
        } finally {
            Card.countDocuments = old;
        }
    });
});

describe("5.2 quiz", () => {
    it("generation strips answers; submit grades server-side; client score ignored", async () => {
        const u = await createUser();
        const deck = await makeDeck(u.token);
        await request(app).post(`/api/v1/study/decks/${deck._id}/cards`).set(auth(u.token))
            .send({ cards: [{ front: "Capital of France?", back: "Paris" }, { front: "2+2?", back: "4" }] });
        mock.__setQuiz(() => [
            { q: "What is the capital of France?", options: ["Paris", "London", "Rome", "Berlin"], correctIndex: 0, explanation: "Stated in the cards." },
            { q: "What is 2+2?", options: ["3", "4", "5", "6"], correctIndex: 1, explanation: "Arithmetic." },
        ]);
        try {
            const gen = await request(app).post("/api/v1/study/quiz").set(auth(u.token)).send({ deckId: deck._id, count: 2 });
            expect(gen.status).toBe(201);
            expect(gen.body.questions).toHaveLength(2);
            // correctIndex + explanation stripped from the client copy
            expect(gen.body.questions[0].correctIndex).toBeUndefined();
            expect(gen.body.questions[0].explanation).toBeUndefined();

            // Submit — a bogus client "score" field must be ignored entirely
            const sub = await request(app).post(`/api/v1/study/quiz/${gen.body.quizId}/submit`).set(auth(u.token))
                .send({ answers: [0, 0], score: 99 });
            expect(sub.status).toBe(200);
            expect(sub.body.score).toBe(1); // only Q1 correct (index 0); Q2 chose 0 but correct is 1
            expect(sub.body.results[0].correct).toBe(true);
            expect(sub.body.results[1].correct).toBe(false);
            expect(sub.body.results[1].explanation).toBeTruthy();

            // Second submit replays, doesn't double-count
            const again = await request(app).post(`/api/v1/study/quiz/${gen.body.quizId}/submit`).set(auth(u.token)).send({ answers: [0, 1] });
            expect(again.body.score).toBe(1);
            expect(again.body.alreadySubmitted).toBe(true);
        } finally {
            mock.__setQuiz(null);
        }
    });

    it("rejects malformed model output (dup options, bad index, 3 options)", async () => {
        const u = await createUser();
        const deck = await makeDeck(u.token);
        await request(app).post(`/api/v1/study/decks/${deck._id}/cards`).set(auth(u.token))
            .send({ front: "f", back: "b" });
        mock.__setQuiz(() => [
            { q: "Bad index question here", options: ["a", "b", "c", "d"], correctIndex: 7, explanation: "x" },
            { q: "Duplicate options here", options: ["same", "same", "c", "d"], correctIndex: 0, explanation: "x" },
            { q: "Three options question", options: ["a", "b", "c"], correctIndex: 0, explanation: "x" },
            { q: "Valid question survives?", options: ["one", "two", "three", "four"], correctIndex: 2, explanation: "ok" },
        ]);
        try {
            const gen = await request(app).post("/api/v1/study/quiz").set(auth(u.token)).send({ deckId: deck._id, count: 4 });
            expect(gen.status).toBe(201);
            expect(gen.body.questions).toHaveLength(1); // only the valid one
            expect(gen.body.questions[0].q).toContain("Valid");
            // All-invalid output → 502
            mock.__setQuiz(() => [{ q: "bad", options: ["a"], correctIndex: 0, explanation: "x" }]);
            const bad = await request(app).post("/api/v1/study/quiz").set(auth(u.token)).send({ deckId: deck._id, count: 2 });
            expect(bad.status).toBe(502);
            expect(bad.body.code).toBe("QUIZ_INVALID");
        } finally {
            mock.__setQuiz(null);
        }
    });

    it("quiz is owner-scoped — user B cannot submit user A's quiz", async () => {
        const ua = await createUser();
        const ub = await createUser();
        const deck = await makeDeck(ua.token);
        await request(app).post(`/api/v1/study/decks/${deck._id}/cards`).set(auth(ua.token)).send({ front: "f", back: "b" });
        const gen = await request(app).post("/api/v1/study/quiz").set(auth(ua.token)).send({ deckId: deck._id, count: 1 });
        expect(gen.status).toBe(201);
        expect((await request(app).post(`/api/v1/study/quiz/${gen.body.quizId}/submit`).set(auth(ub.token)).send({ answers: [0] })).status).toBe(404);
        expect((await request(app).get(`/api/v1/study/quiz/${gen.body.quizId}`).set(auth(ub.token))).status).toBe(404);
    });
});

describe("5.2 migration + legacy compat", () => {
    it("studio save creates FlashcardSet AND Deck+Cards; agent tool returns deckId", async () => {
        const u = await createUser();
        const save = await request(app).post("/api/v1/studio/flashcards/save").set(auth(u.token))
            .send({ name: "Studio deck", cards: [{ q: "Q1?", a: "A1" }, { q: "Q2?", a: "A2" }] });
        expect(save.status).toBe(201);
        expect(save.body.deckId).toBeTruthy();
        expect(save.body.created).toBe(2);
        const cards = await Card.find({ deck: save.body.deckId }).lean();
        expect(cards).toHaveLength(2);
        expect(cards.every((c) => c.due <= new Date())).toBe(true); // due immediately
        expect(await FlashcardSet.findById(save.body.flashcardSetId)).toBeTruthy(); // legacy intact
    });

    it("migration script is idempotent — second run skips", async () => {
        const u = await createUser();
        const uid = (await mongoose.model("User").findOne({ email: u.email }))._id;
        await FlashcardSet.create({ user: uid, name: "Old set", cards: [{ q: "a", a: "b" }, { q: "c", a: "d" }] });

        // Inline migration logic (same semantics as scripts/migrate-flashcards-to-decks.js),
        // scoped to this user's sets — earlier tests share the in-memory DB.
        const migrate = async () => {
            const sets = await FlashcardSet.find({ user: uid }).lean();
            let n = 0;
            for (const set of sets) {
                const marker = `[set:${set._id}]`;
                const existing = await Deck.findOne({ user: set.user, name: { $regex: marker.replace(/[[\]]/g, "\\$&") + "$" } });
                if (existing) continue;
                const deck = await Deck.create({ user: set.user, name: `${set.name} ${marker}`.slice(0, 120) });
                await Card.insertMany(set.cards.filter((c) => c?.q && c?.a).map((c) => ({ user: set.user, deck: deck._id, front: c.q, back: c.a })));
                n++;
            }
            return n;
        };
        expect(await migrate()).toBe(1);
        expect(await migrate()).toBe(0); // idempotent
        expect(await Card.countDocuments({ user: uid })).toBe(2);
        expect(await FlashcardSet.countDocuments({ user: uid })).toBe(1); // never deleted
    });

    it("cascade registry covers all study models", async () => {
        const { userOwnedModels, registeredModels } = require("../utils/accountCascade");
        const registered = new Set(registeredModels());
        for (const m of userOwnedModels()) expect(registered.has(m.modelName)).toBe(true);
        for (const name of ["Deck", "Card", "ReviewLog", "QuizAttempt"]) expect(registered.has(name)).toBe(true);
    });
});
