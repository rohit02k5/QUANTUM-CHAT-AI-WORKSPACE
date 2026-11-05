// Atlas verification checklist for Phase 5 (memory, study, quiz, export,
// public API keys, cascade), run against the real cluster on database
// "quantum_ai_eval" with a throwaway user that is deleted at the end.
// Usage: node scripts/atlas-verify-5.js
// Requires MONGO_URI + GEMINI_API_KEY in the environment. Never prints secrets.
// Generation-dependent steps report SKIP when the Gemini quota is exhausted.
require("dotenv").config();
const request = require("supertest");
const mongoose = require("mongoose");

process.env.INGEST_SYNC = "true";
process.env.MEMORY_EVERY_N_TURNS = "1"; // extraction fires on the first turn
const app = require("../app");
const EVAL_DB = process.env.EVAL_MONGO_DB || "quantum_ai_eval";

const results = [];
let quotaExhausted = false;
const quotaSkip = (name, err) => {
    const quota = quotaExhausted || /429|503|quota|RESOURCE_EXHAUSTED|rate.?limit/i.test(String(err?.message || err));
    if (quota) quotaExhausted = true;
    results.push(`${quota ? "SKIP " : "FAIL "}${name}${quota ? " — Gemini quota exhausted, re-run after reset" : ": " + (err?.message || err)}`);
    return quota;
};
const step = (name, ok, detail = "") =>
    results.push(`${ok ? "PASS " : "FAIL "}${name}${detail ? " — " + detail : ""}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Probe the cheap lane directly: memory extraction and quiz generation
// degrade silently when every model is quota-dead — a live probe tells
// "feature broken" apart from "quota exhausted".
const cheapAlive = async () => {
    try {
        await require("../utils/geminiHelper").generateCheapest("Reply with the single word OK.", {}, "atlas-probe");
        return true;
    } catch { return false; }
};
const poll = async (fn, tries = 8, ms = 3000) => {
    for (let i = 0; i < tries; i++) {
        const v = await fn();
        if (v) return v;
        await sleep(ms);
    }
    return null;
};

async function main() {
    const uri = process.env.MONGO_URI;
    if (!uri) { console.error("Set MONGO_URI"); process.exit(1); }
    await mongoose.connect(uri, { dbName: EVAL_DB });
    console.log(`connected to ${mongoose.connection.host} db=${EVAL_DB}`);
    const db = mongoose.connection.db;
    const File = require("../models/File");
    const Chunk = require("../models/Chunk");
    const Memory = require("../models/Memory");
    const Deck = require("../models/Deck");
    const Card = require("../models/Card");
    const User = require("../models/userModel");
    const geminiHelper = require("../utils/geminiHelper");

    const t = `atlas5-${Date.now()}`;
    const res = await request(app).post("/api/v1/auth/register")
        .send({ username: "atlas5", email: `${t}@t.com`, password: "AtlasVerify5!" });
    const token = res.body?.token;
    step("register throwaway user", !!token);
    const auth = { Authorization: `Bearer ${token}` };
    const userId = (await User.findOne({ email: `${t}@t.com` }))?._id;

    try {
        // Preflight: is the Gemini generate quota usable?
        try {
            await geminiHelper.generateContentWithRetry("Reply with the single word OK.", {}, 1, "chat");
            results.push("INFO gemini generate quota: available");
        } catch (e) {
            quotaExhausted = /429|503|quota|RESOURCE_EXHAUSTED/i.test(String(e?.message || e));
            results.push(`INFO gemini generate quota: ${quotaExhausted ? "exhausted — generation steps will SKIP" : "error: " + e.message}`);
        }

        // Seed one ready file (no AI needed for a direct chunk insert… but the
        // embedding call is real; quota-check it separately from generation)
        let seededFile = null;
        try {
            const text = "The Zephyr-9 industrial mixer uses a planetary gearbox rated at 40 Nm torque. Service manual ref ZMX-4409.";
            seededFile = await File.create({ user: userId, filename: "mixer.txt", originalName: "mixer.txt", path: "x", mimetype: "text/plain", status: "ready", content: text });
            const emb = await geminiHelper.getEmbedding(text, { task: "document" });
            await Chunk.create({
                user: userId, file: seededFile._id, text, pageContent: text,
                metadata: { chunkIndex: 0 }, type: "text",
                embedding: emb, embeddingDims: emb.length,
                embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2",
            });
            step("seed ready file + embedded chunk", true);
        } catch (e) {
            quotaSkip("seed ready file + embedded chunk", e);
        }

        // ------------------------------------------------------------------
        // 1. MEMORY — preference in chat A -> memory row -> used in chat B ->
        //    delete -> no longer applies
        // ------------------------------------------------------------------
        let memoryId = null;
        try {
            const chatA = await request(app).post("/api/v1/chat/message").set(auth)
                .send({ message: "I prefer answers in German. I am a mechanical engineer." });
            if (chatA.status !== 200) throw new Error(`chat A ${chatA.status}: ${JSON.stringify(chatA.body).slice(0, 120)}`);
            const mem = await poll(async () => Memory.findOne({ user: userId }).lean());
            if (!mem && !(await cheapAlive())) {
                quotaSkip("memory: extraction wrote a memory row", new Error("cheap lane quota-dead — extraction skipped gracefully (by design)"));
            } else {
                step("memory: extraction wrote a memory row", !!mem, mem ? `"${String(mem.text).slice(0, 70)}" (${mem.category})` : "none after 24s");
            }
            memoryId = mem?._id;

            if (mem) {
                const chatB = await request(app).post("/api/v1/chat/message").set(auth)
                    .send({ message: "What is the gearbox torque rating?" });
                const usedIds = (chatB.body?.usedMemories || []).map(String);
                // Extraction may write several memories; any of the user's own
                // rows being injected counts (never another user's — the query
                // is owner-scoped).
                const owned = new Set((await Memory.find({ user: userId }).select("_id").lean()).map((m) => String(m._id)));
                step("memory: chat B injected the memory (usedMemories)", usedIds.some((id) => owned.has(id)),
                    `used=[${usedIds.join(",")}]`);

                // Forget-all → no memory applies any more
                await request(app).delete("/api/v1/memories").set(auth);
                const chatC = await request(app).post("/api/v1/chat/message").set(auth)
                    .send({ message: "And the service manual reference?" });
                const usedC = (chatC.body?.usedMemories || []).length;
                const gone = !(await Memory.exists({ user: userId }));
                step("memory: forget-all stops injection", gone && usedC === 0, `deleted=${gone} usedMemories=${usedC}`);
            } else {
                step("memory: chat B injection", false, "no memory row produced");
            }
        } catch (e) {
            quotaSkip("memory lifecycle", e);
        }

        // ------------------------------------------------------------------
        // 2. STUDY — deck + card -> review moves due per SM-2 -> stats
        // ------------------------------------------------------------------
        try {
            const deck = await request(app).post("/api/v1/study/decks").set(auth).send({ name: "Mixers" });
            step("study: create deck", deck.status === 201, `status=${deck.status}`);
            const deckId = deck.body?.deck?._id || deck.body?._id;
            const card = await request(app).post(`/api/v1/study/decks/${deckId}/cards`).set(auth)
                .send({ front: "Gearbox torque?", back: "40 Nm" });
            step("study: create card due immediately", card.status === 201, `status=${card.status}`);
            const cardId = card.body?.cards?.[0]?._id || card.body?.card?._id || card.body?._id;

            const due = await request(app).get(`/api/v1/study/due?deck=${deckId}`).set(auth);
            step("study: card appears in due list", due.status === 200 && (due.body?.cards || []).some((c) => String(c._id) === String(cardId)));

            const rev = await request(app).post("/api/v1/study/review").set(auth).send({ cardId, grade: 5 });
            const doc = await Card.findById(cardId).lean();
            step("study: review moves due per SM-2", rev.status === 200 && doc.reps === 1 && doc.intervalDays >= 1 && new Date(doc.due) > new Date(),
                `reps=${doc?.reps} interval=${doc?.intervalDays}d ease=${doc?.ease}`);

            const stats = await request(app).get("/api/v1/study/stats?tz=UTC").set(auth);
            step("study: stats reflect the review", stats.status === 200 && stats.body.totalCards === 1 && stats.body.streak >= 1,
                `total=${stats.body?.totalCards} streak=${stats.body?.streak} retention=${stats.body?.retention}`);
        } catch (e) {
            quotaSkip("study flow", e);
        }

        // ------------------------------------------------------------------
        // 3. QUIZ — generate from the real file, submit, server-side grading
        // ------------------------------------------------------------------
        try {
            if (!seededFile) throw new Error("no seeded file");
            const quiz = await request(app).post("/api/v1/study/quiz").set(auth)
                .send({ fileId: String(seededFile._id), count: 3 });
            if (quotaExhausted || quiz.status >= 500) {
                if (!(await cheapAlive())) quotaSkip("quiz generation", new Error(`status ${quiz.status} + cheap lane dead`));
                else step("quiz generation", false, `status ${quiz.status} with cheap lane alive`);
            } else {
                step("quiz: generated from real file", quiz.status === 201 && quiz.body.questions.length > 0,
                    `${quiz.body?.questions?.length} questions, status=${quiz.status}`);
                const answers = quiz.body.questions.map(() => 0); // deliberately wrong-ish guess
                const sub = await request(app).post(`/api/v1/study/quiz/${quiz.body.quizId}/submit`).set(auth).send({ answers });
                step("quiz: server-side grading returns score + explanations",
                    sub.status === 200 && typeof sub.body.score === "number" && sub.body.results.every((r) => typeof r.correct === "boolean" && r.explanation),
                    `score=${sub.body?.score}/${sub.body?.total}`);
            }
        } catch (e) {
            quotaSkip("quiz flow", e);
        }

        // ------------------------------------------------------------------
        // 4. EXPORT — chat Markdown + cards CSV content inspection
        // ------------------------------------------------------------------
        try {
            const chat = await request(app).post("/api/v1/chat/message").set(auth)
                .send({ message: "export me please" });
            const chatId = chat.body?.chatId;
            const md = await request(app).get(`/api/v1/export/chat/${chatId}`).set(auth).buffer(true).parse((r, cb) => {
                let d = ""; r.on("data", (c) => d += c); r.on("end", () => cb(null, d));
            });
            const mdText = String(md.body || md.text || "");
            step("export: chat Markdown has title + messages", md.status === 200 && /^# /.test(mdText) && mdText.includes("export me please"),
                `${mdText.length} bytes`);
            const csv = await request(app).get("/api/v1/export/cards.csv").set(auth).buffer(true).parse((r, cb) => {
                const b = []; r.on("data", (c) => b.push(c)); r.on("end", () => cb(null, Buffer.concat(b)));
            });
            const csvText = (csv.body || Buffer.alloc(0)).toString("utf8");
            step("export: cards CSV has BOM + header + row",
                csv.status === 200 && csvText.charCodeAt(0) === 0xFEFF && csvText.includes("Front,Back,Deck") && csvText.includes("Gearbox torque?"),
                `${csvText.length} bytes, first lines: ${csvText.split("\n").slice(0, 2).join(" | ").slice(0, 90)}`);
        } catch (e) {
            quotaSkip("export flow", e);
        }

        // ------------------------------------------------------------------
        // 5. PUBLIC API KEY — create, call, caps, revocation
        // ------------------------------------------------------------------
        try {
            const created = await request(app).post("/api/v1/keys").set(auth).send({ name: "atlas-check" });
            const plaintext = created.body?.key;
            step("apikey: created, shown once", created.status === 201 && /^qk_/.test(plaintext || ""));
            const ApiKey = require("../models/ApiKey");
            const stored = await ApiKey.findById(created.body?.apiKey?._id).lean();
            step("apikey: only hash + prefix persisted", stored && !JSON.stringify(stored).includes(plaintext));

            const pub = await request(app).post("/api/v1/public/chat")
                .set("Authorization", `Bearer ${plaintext}`)
                .send({ message: "What is the gearbox torque rating?" });
            if (pub.status === 200) {
                step("apikey: public chat returns answer + owner citations",
                    Array.isArray(pub.body.sources) && pub.body.sources.every((s) => s.fileId === String(seededFile._id)),
                    `sources=${pub.body.sources.length}`);
            } else {
                quotaSkip("apikey: public chat", new Error(`status ${pub.status}`));
            }

            // Rate limit bookkeeping visible?
            const listed = await request(app).get("/api/v1/keys").set(auth);
            step("apikey: lastUsedAt recorded", !!listed.body?.keys?.[0]?.lastUsedAt);

            await request(app).delete(`/api/v1/keys/${created.body.apiKey._id}`).set(auth);
            const after = await request(app).post("/api/v1/public/chat")
                .set("Authorization", `Bearer ${plaintext}`).send({ message: "hi" });
            step("apikey: revoked key gets 401", after.status === 401);
        } catch (e) {
            quotaSkip("apikey flow", e);
        }

        // ------------------------------------------------------------------
        // 6. CASCADE — every Phase 5 collection emptied for the user
        // ------------------------------------------------------------------
        const { cascadeDelete } = require("../utils/accountCascade");
        await cascadeDelete(userId);
        const leftovers = {};
        for (const collName of ["chats", "files", "chunks", "memories", "decks", "cards", "reviewlogs", "quizattempts", "apikeys", "usageevents", "ingestionjobs", "aidailyquotas"]) {
            leftovers[collName] = await db.collection(collName).countDocuments({ user: userId }).catch(() => -1);
        }
        const blobs = await db.collection("fs.files").countDocuments({}).catch(() => -1);
        const totalLeft = Object.values(leftovers).reduce((a, b) => a + Math.max(0, b), 0);
        step("deletion cascade: zero Phase-5 documents", totalLeft === 0, JSON.stringify(leftovers));
        step("deletion cascade: zero GridFS blobs remain", blobs === 0, `${blobs} fs.files docs`);
        await User.deleteOne({ _id: userId });

        // ------------------------------------------------------------------
        // 7. Cluster state — storage + prod index count (must still be 1 of 3)
        // ------------------------------------------------------------------
        const stats = await db.stats();
        let prodIdx = "n/a", prodDbName = "default";
        try {
            const prodConn = await mongoose.createConnection(uri).asPromise();
            prodDbName = prodConn.db.databaseName;
            const prodChunks = await prodConn.db.listCollections({ name: "chunks" }).toArray();
            if (prodChunks.length) {
                prodIdx = (await prodConn.db.collection("chunks").listSearchIndexes().toArray()).length;
            }
            await prodConn.close();
        } catch (e) { prodIdx = "n/a (" + e.message.slice(0, 60) + ")"; }
        results.push(`INFO eval-db storage ${(stats.storageSize / 1e6).toFixed(1)} MB; prod db "${prodDbName}" search indexes on chunks: ${prodIdx} (must still be 1 of 3)`);
    } finally {
        if (token) {
            await request(app).delete("/api/v1/auth/account").set(auth)
                .send({ password: "AtlasVerify5!" }).catch(() => {});
            const left = await File.countDocuments({ originalName: "mixer.txt" });
            step("no leftover test files", left === 0, `${left} left`);
        }
    }
    console.log(results.join("\n"));
    const fails = results.filter((r) => r.startsWith("FAIL")).length;
    console.log(`\n${results.filter((r) => r.startsWith("PASS")).length} pass, ${fails} fail, ${results.filter((r) => r.startsWith("SKIP")).length} skip`);
    await mongoose.disconnect();
    process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error("fatal:", e); process.exit(1); });
