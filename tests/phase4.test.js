// Phase 4: quota-aware jobs, deletion cascade, hybrid retrieval, rerank,
// query rewriting, semantic global search, chat summaries.
const mongoose = require("mongoose");
const crypto = require("crypto");
const { request, app, createUser, auth } = require("./helpers");
const File = require("../models/File");
const Chunk = require("../models/Chunk");
const Chat = require("../models/Chat");
const IngestionJob = require("../models/IngestionJob");
const RerankCache = require("../models/RerankCache");
const retriever = require("../utils/retriever");
const mock = require("../utils/geminiMock");
const jobRunner = require("../utils/jobRunner");
const { cascadeDelete, registeredModels, userOwnedModels } = require("../utils/accountCascade");
const { maybeRewriteQuery, looksContextDependent } = require("../utils/queryRewrite");
const { rerankChunks } = require("../utils/rerank");
const { maybeSummarizeChat, needsSummary } = require("../utils/chatSummary");

const EMBED_MODEL = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2";

const ENV_KEYS = ["RAG_HYBRID", "RAG_RERANK", "RAG_REWRITE", "RAG_KEYWORD_MIN_SCORE"];
let savedEnv;
beforeEach(() => {
    savedEnv = {};
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
});
afterEach(() => {
    for (const k of ENV_KEYS) {
        if (savedEnv[k] === undefined) delete process.env[k];
        else process.env[k] = savedEnv[k];
    }
    mock.__setRewrite(null);
    mock.__setRerank(null);
    retriever._resetIndexCache();
});

/** Seed a READY file + chunks for `userId`. Texts may carry SIM: tokens. */
async function seedChunks(userId, texts, { filename = "doc.txt", status, model = EMBED_MODEL } = {}) {
    const file = await File.create({
        user: userId, filename, originalName: filename, path: "x",
        mimetype: "text/plain", ...(status ? { status } : {}),
    });
    const chunks = [];
    for (const [i, text] of texts.entries()) {
        chunks.push(await Chunk.create({
            user: userId, file: file._id, text, pageContent: text,
            metadata: { chunkIndex: i }, type: "text",
            embedding: await mock.embed(text),
            embeddingDims: 768, embeddingModel: model,
        }));
    }
    return { file, chunks };
}

// ---------------------------------------------------------------------------
// 4.2 RRF + hybrid retrieval
// ---------------------------------------------------------------------------
describe("4.2 RRF + hybrid retrieval", () => {
    it("rrf() fuses legs deterministically with reciprocal-rank scores", () => {
        const mk = (id, score) => ({ _id: id, text: id, score });
        const fused = retriever.rrf([
            { leg: "vector", results: [mk("a", 0.9), mk("b", 0.8)] },
            { leg: "keyword", results: [mk("b", 5), mk("c", 4)], weight: 1 },
        ], 60);
        // b is in both legs → highest fused score
        expect(fused[0].chunk._id).toBe("b");
        expect(fused[0].legs).toEqual(["vector", "keyword"]);
        // a (vector-only) beats c (keyword rank-1 + vector miss)
        expect(fused[1].chunk._id).toBe("a");
        expect(fused[2].chunk._id).toBe("c");
        // Deterministic: same input → same output
        const again = retriever.rrf([
            { leg: "vector", results: [mk("a", 0.9), mk("b", 0.8)] },
            { leg: "keyword", results: [mk("b", 5), mk("c", 4)], weight: 1 },
        ], 60);
        expect(again.map((e) => e.chunk._id)).toEqual(fused.map((e) => e.chunk._id));
    });

    it("keyword leg is owner-scoped: user B never gets user A's chunks", async () => {
        const userA = new mongoose.Types.ObjectId();
        const userB = new mongoose.Types.ObjectId();
        await retriever.ensureTextIndex();
        await seedChunks(userA, ["zebra quixotic umbrella foxglove exactterms"]);
        const res = await retriever.retrieveChunks(userB, "zebra quixotic umbrella foxglove", 5, [], { mode: "keyword" });
        expect(res).toHaveLength(0);
    });

    it("keyword admission rule rejects weak lexical matches", async () => {
        const userId = new mongoose.Types.ObjectId();
        await retriever.ensureTextIndex();
        await seedChunks(userId, ["apple banana cherry durian elderberry fig grape honeydew"]);
        // Mongo textScore ≈ 0.58/matched term; KEYWORD_MIN_SCORE=3 needs ~6+
        const res = await retriever.retrieveChunks(userId, "apple banana cherry xylophone zephyr", 5, [], { mode: "keyword" });
        expect(res).toHaveLength(0); // 3-term overlap → score ~1.75 < 3
        const strong = await retriever.retrieveChunks(userId, "apple banana cherry durian elderberry fig grape", 5, [], { mode: "keyword" });
        expect(strong.length).toBeGreaterThan(0); // 7-term overlap → score ~4 admitted
    });

    it("hybrid works when the vector index is absent (cosine fallback + keyword)", async () => {
        const userId = new mongoose.Types.ObjectId();
        await retriever.ensureTextIndex();
        await seedChunks(userId, ["SIM:gamma cats purr softly", "unrelated rocks sediment"]);
        const coll = mongoose.connection.collection("chunks");
        const origList = coll.listSearchIndexes;
        coll.listSearchIndexes = () => ({ toArray: async () => [] });
        retriever._resetIndexCache();
        try {
            const res = await retriever.retrieveChunks(userId, "SIM:gamma feline purring", 5, [], { mode: "hybrid" });
            expect(res.length).toBeGreaterThan(0);
            expect(res[0].text).toMatch(/cats/);
        } finally {
            coll.listSearchIndexes = origList;
            retriever._resetIndexCache();
        }
    });

    it("ready-only + file-scope filters apply to the keyword leg", async () => {
        const userId = new mongoose.Types.ObjectId();
        await retriever.ensureTextIndex();
        const proc = await seedChunks(userId, ["quartz granite obsidian minerals"], { filename: "processing.txt", status: "processing" });
        const res = await retriever.retrieveChunks(userId, "quartz granite obsidian", 5, [], { mode: "keyword" });
        expect(res.find((r) => String(r.fileId) === String(proc.file._id))).toBeUndefined();
    });

    it("response shape stays backward compatible and reports legs", async () => {
        const userId = new mongoose.Types.ObjectId();
        await retriever.ensureTextIndex();
        await seedChunks(userId, ["SIM:delta alpha beta gamma terms"]);
        const res = await retriever.retrieveChunks(userId, "SIM:delta alpha beta gamma", 5, [], { mode: "hybrid" });
        expect(res.length).toBeGreaterThan(0);
        const r = res[0];
        expect(typeof r.text).toBe("string");
        expect(typeof r.score).toBe("number");
        expect(r.scores).toHaveProperty("fused");
        expect(Array.isArray(r.matchedBy)).toBe(true);
        expect(r.matchedBy.length).toBeGreaterThan(0);
    });

    it("chunks with a mismatched embedding model are ignored", async () => {
        const userId = new mongoose.Types.ObjectId();
        await seedChunks(userId, ["SIM:epsilon old model chunk"], { model: "some-other-model" });
        const res = await retriever.retrieveChunks(userId, "SIM:epsilon old model", 5);
        expect(res).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// 4.3 rerank
// ---------------------------------------------------------------------------
describe("4.3 rerank", () => {
    const mkChunks = (n) =>
        Array.from({ length: n }, (_, i) => ({
            _id: new mongoose.Types.ObjectId(), text: `chunk ${i}`, fileId: new mongoose.Types.ObjectId(),
            originalName: "d.txt", metadata: {}, score: 0.9 - i * 0.01,
        }));

    it("reorders candidates by the model's validated order", async () => {
        mock.__setRerank(() => ({ order: [2, 0, 1] }));
        const chunks = mkChunks(3);
        const out = await rerankChunks({ userId: new mongoose.Types.ObjectId(), query: "q", chunks });
        expect(out.map((c) => c.text)).toEqual(["chunk 2", "chunk 0", "chunk 1"]);
    });

    it("falls back to the original order on invalid output", async () => {
        mock.__setRerank(() => ({ order: [99, -1, "x"] }));
        const chunks = mkChunks(3);
        const out = await rerankChunks({ userId: new mongoose.Types.ObjectId(), query: "q2", chunks });
        expect(out.map((c) => c.text)).toEqual(chunks.map((c) => c.text));
    });

    it("falls back silently when the reranker throws", async () => {
        mock.__setRerank(() => { throw new Error("boom"); });
        const chunks = mkChunks(2);
        const out = await rerankChunks({ userId: new mongoose.Types.ObjectId(), query: "q3", chunks });
        expect(out).toEqual(chunks);
    });

    it("serves repeated identical calls from the Mongo cache (one generate call)", async () => {
        mock.__setRerank(() => ({ order: [1, 0] }));
        const userId = new mongoose.Types.ObjectId();
        const chunks = mkChunks(2);
        const keyOf = (cs, q) => crypto.createHash("sha256")
            .update(`${userId}|${crypto.createHash("sha256").update(q).digest("hex")}|${cs.map((c) => String(c._id)).join(",")}`)
            .digest("hex");
        const first = await rerankChunks({ userId, query: "qq", chunks });
        expect(first[0].text).toBe("chunk 1");
        mock.__setRerank(() => { throw new Error("must not be called"); }); // cache hit
        const second = await rerankChunks({ userId, query: "qq", chunks });
        expect(second[0].text).toBe("chunk 1");
        const cached = await RerankCache.findOne({ user: userId, key: keyOf(chunks, "qq") });
        expect(cached).toBeTruthy();
        expect(cached.order).toEqual([1, 0]);
    });
});

// ---------------------------------------------------------------------------
// 4.4 query rewriting
// ---------------------------------------------------------------------------
describe("4.4 query rewriting", () => {
    it("detects context-dependent vs standalone messages", () => {
        expect(looksContextDependent("How long does it take?")).toBe(true);
        expect(looksContextDependent("Tell me more about that")).toBe(true);
        expect(looksContextDependent("What is the capital of France?")).toBe(false);
    });

    it("returns the original message for first-turn / standalone input", async () => {
        const a = await maybeRewriteQuery("How long does it take?", []);
        expect(a).toEqual({ query: "How long does it take?", rewritten: false });
        const b = await maybeRewriteQuery("What is the capital of France?", [
            { role: "user", content: "hi" }, { role: "model", content: "hello" },
        ]);
        expect(b.rewritten).toBe(false);
    });

    it("rewrites a follow-up when the model returns a standalone query", async () => {
        mock.__setRewrite(() => ({ needsRewrite: true, standalone: "How long does a Hohmann transfer take?" }));
        const out = await maybeRewriteQuery("How long does it take?", [
            { role: "user", content: "Tell me about Hohmann transfers" },
            { role: "model", content: "They move between circular orbits." },
        ]);
        expect(out.rewritten).toBe(true);
        expect(out.query).toBe("How long does a Hohmann transfer take?");
    });

    it("falls back to the original on model failure or malformed output", async () => {
        mock.__setRewrite(() => { throw new Error("quota"); });
        const out = await maybeRewriteQuery("Tell me more about that", [
            { role: "user", content: "x" }, { role: "model", content: "y" },
        ]);
        expect(out).toEqual({ query: "Tell me more about that", rewritten: false });
    });

    it("RAG_REWRITE=false disables rewriting entirely", async () => {
        process.env.RAG_REWRITE = "false";
        mock.__setRewrite(() => ({ needsRewrite: true, standalone: "forced" }));
        const out = await maybeRewriteQuery("Tell me more", [{ role: "user", content: "x" }]);
        expect(out.rewritten).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// 4.5 semantic global search + chat summaries
// ---------------------------------------------------------------------------
describe("4.5 global search + summaries", () => {
    it("groups results and isolates users", async () => {
        const uA = await createUser();
        const uB = await createUser();
        // uA: a READY file + an embedded chunk + a summarized chat
        const uid = (await mongoose.model("User").findOne({ email: uA.email }))._id;
        await seedChunks(uid, ["SIM:zeta lunar regolith analysis"]);
        await Chat.create({
            user: uid, title: "Moon dust discussion",
            summary: "Discussion about lunar regolith composition",
            summaryEmbedding: await mock.embed("SIM:zeta lunar regolith"),
            summaryEmbeddingModel: EMBED_MODEL, summaryEmbeddingDims: 768,
            messages: [
                { role: "user", content: "tell me about moon dust" },
                { role: "model", content: "regolith is..." },
            ],
        });
        const res = await request(app)
            .get("/api/v1/search?query=SIM:zeta lunar dust&mode=smart")
            .set(auth(uA.token));
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.chats)).toBe(true);
        expect(Array.isArray(res.body.files)).toBe(true);
        expect(res.body.chats[0]).toHaveProperty("matchType");
        // user B sees nothing of user A's data
        const resB = await request(app)
            .get("/api/v1/search?query=SIM:zeta lunar dust&mode=smart")
            .set(auth(uB.token));
        expect(resB.status).toBe(200);
        expect(resB.body.chats).toHaveLength(0);
        expect(resB.body.files).toHaveLength(0);
    });

    it("exact mode escapes regex metacharacters", async () => {
        const u = await createUser();
        const uid = (await mongoose.model("User").findOne({ email: u.email }))._id;
        await File.create({
            user: uid, filename: "a.txt", originalName: "a.txt", path: "x",
            mimetype: "text/plain", content: "price is $100 (total)",
        });
        const res = await request(app)
            .get("/api/v1/search?query=$100%20(total)&mode=exact")
            .set(auth(u.token));
        expect(res.status).toBe(200);
        expect(res.body.files.length).toBe(1); // literal match, not regex
    });

    it("needsSummary gates on message growth, maybeSummarizeChat writes a summary", async () => {
        const uid = new mongoose.Types.ObjectId();
        const chat = await Chat.create({
            user: uid, title: "t",
            messages: [{ role: "user", content: "hello there" }, { role: "model", content: "hi" }],
        });
        expect(needsSummary(chat)).toBe(true);
        const wrote = await maybeSummarizeChat(chat._id);
        expect(wrote).toBe(true);
        const after = await Chat.findById(chat._id).select("+summaryEmbedding");
        expect(after.summary.length).toBeLessThanOrEqual(300);
        expect(after.summaryEmbedding.length).toBe(768);
        expect(after.summaryMessageCount).toBe(2);
        // Below the 10-message refresh threshold → no resummarize
        expect(needsSummary(after)).toBe(false);
        after.messages = new Array(14).fill(null).map((_, i) => ({ role: i % 2 ? "model" : "user", content: `m${i}` }));
        expect(needsSummary(after)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 4.0b quota-aware ingestion
// ---------------------------------------------------------------------------
describe("4.0b quota-aware jobs", () => {
    it("daily-quota failure requeues with notBefore and does NOT increment attempts", async () => {
        const uid = new mongoose.Types.ObjectId();
        const file = await File.create({ user: uid, filename: "q.txt", originalName: "q.txt", path: "x", mimetype: "text/plain", status: "processing" });
        const job = await IngestionJob.create({ user: uid, file: file._id, status: "processing", attempts: 1 });
        const quotaErr = new Error("429 RESOURCE_EXHAUSTED: GenerateRequestsPerDay quota exceeded — Please retry in 1h");
        await jobRunner.failOrRequeue(job, quotaErr);
        expect(job.status).toBe("queued");
        expect(job.attempts).toBe(0); // claim increment undone
        expect(job.notBefore.getTime()).toBeGreaterThan(Date.now());
        expect(job.error).toBe("Waiting for AI quota");
        // not claimable until notBefore passes
        const claimable = await jobRunner.claimNext();
        expect(claimable).toBeNull();
    });

    it("real failures still increment toward maxAttempts", async () => {
        const uid = new mongoose.Types.ObjectId();
        const file = await File.create({ user: uid, filename: "f.txt", originalName: "f.txt", path: "x", mimetype: "text/plain", status: "processing" });
        const job = await IngestionJob.create({ user: uid, file: file._id, status: "processing", attempts: 1 });
        await jobRunner.failOrRequeue(job, new Error("parse exploded"));
        expect(job.attempts).toBe(1); // untouched by failOrRequeue itself
        expect(job.status).toBe("queued");
    });
});

// ---------------------------------------------------------------------------
// 4.0c account deletion
// ---------------------------------------------------------------------------
describe("4.0c account deletion", () => {
    it("cascade registry covers every Mongoose model with a `user` path", () => {
        const registered = new Set(registeredModels());
        const unregistered = userOwnedModels()
            .map((m) => m.modelName)
            .filter((name) => !registered.has(name) && name !== "User");
        expect(unregistered).toEqual([]);
    });

    it("password users must confirm with their password", async () => {
        const u = await createUser();
        // no body → rejected
        const bad = await request(app).delete("/api/v1/auth/account").set(auth(u.token)).send({});
        expect(bad.status).toBe(401);
        // wrong password → rejected
        const wrong = await request(app).delete("/api/v1/auth/account").set(auth(u.token)).send({ password: "nope" });
        expect(wrong.status).toBe(401);
        // right password → account + cascade
        const ok = await request(app).delete("/api/v1/auth/account").set(auth(u.token)).send({ password: u.password });
        expect(ok.status).toBe(200);
        expect(ok.body.success).toBe(true);
    });

    it("cascade removes chats, files, chunks, jobs, and usage events", async () => {
        const u = await createUser();
        const uid = (await mongoose.model("User").findOne({ email: u.email }))._id;
        await seedChunks(uid, ["cascade test chunk"]);
        await Chat.create({ user: uid, title: "x", messages: [{ role: "user", content: "hi" }] });
        await IngestionJob.create({ user: uid, file: new mongoose.Types.ObjectId(), status: "queued" });
        const deleted = await cascadeDelete(uid);
        expect(await Chunk.countDocuments({ user: uid })).toBe(0);
        expect(await Chat.countDocuments({ user: uid })).toBe(0);
        expect(await File.countDocuments({ user: uid })).toBe(0);
        expect(await IngestionJob.countDocuments({ user: uid })).toBe(0);
        expect(deleted.Chunk).toBeGreaterThanOrEqual(1);
    });
});

// ---------------------------------------------------------------------------
// 5.0c identifier-rescue keyword admission
// ---------------------------------------------------------------------------
describe("5.0c identifier-rescue admission", () => {
    it("identifierTokens extracts identifier-like tokens only", () => {
        const toks = retriever.identifierTokens("what does ERR-4021 mean in release v4.1.7 for SKU-8842-A?");
        expect(toks).toEqual(expect.arrayContaining(["ERR-4021", "v4.1.7", "SKU-8842-A"]));
        // plain words with no digits are not identifiers
        expect(toks).not.toEqual(expect.arrayContaining(["what", "does", "mean", "release", "for"]));
    });

    it("single-token identifier is admitted despite a low textScore", async () => {
        const userId = new mongoose.Types.ObjectId();
        await retriever.ensureTextIndex();
        // A doc whose only distinguishing term is a unique identifier. The
        // textScore for one matched term (~0.58) is far below KEYWORD_MIN_SCORE.
        await seedChunks(userId, ["deployment notes mention defect ERR-4021 in the scheduler"]);
        const res = await retriever.retrieveChunks(userId, "ERR-4021", 5, [], { mode: "keyword" });
        expect(res.length).toBeGreaterThan(0);
        expect(res[0].text).toContain("ERR-4021");
        expect(res[0].matchedBy).toContain("keyword");
    });

    it("identifier-rescue does not admit non-exact or substring-only matches", async () => {
        const userId = new mongoose.Types.ObjectId();
        await retriever.ensureTextIndex();
        await seedChunks(userId, ["release 44.1.70 shipped last quarter"]);
        // "4.1.7" must NOT substring-match inside "44.1.70" (boundary check)
        const res = await retriever.retrieveChunks(userId, "4.1.7", 5, [], { mode: "keyword" });
        expect(res).toHaveLength(0);
        // and a digit-free weak query still gets rejected by the score rule
        const res2 = await retriever.retrieveChunks(userId, "release", 5, [], { mode: "keyword" });
        expect(res2).toHaveLength(0);
    });

    it("hybrid mode surfaces an identifier-only hit the vector leg missed", async () => {
        const userId = new mongoose.Types.ObjectId();
        await retriever.ensureTextIndex();
        // Mock embeddings are deterministic seeded vectors — the vector leg
        // may or may not rank this chunk; the keyword leg must rescue it and
        // the fused result must contain it.
        await seedChunks(userId, ["generic filler text about workflows", "the runbook for incident INC-9917 lists rollback steps"]);
        const res = await retriever.retrieveChunks(userId, "INC-9917", 5, [], { mode: "hybrid" });
        expect(res.some((c) => c.text.includes("INC-9917"))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 5.0d per-user daily AI cap
// ---------------------------------------------------------------------------
describe("5.0d daily AI cap", () => {
    const { tryConsume, status, CAP } = require("../utils/aiQuota");

    it("admits up to the cap then returns AI_USER_CAP_REACHED", async () => {
        const u = await createUser();
        const uid = (await mongoose.model("User").findOne({ email: u.email }))._id;
        // Burn the cap directly (CAP is 60 by default — faster than HTTP)
        for (let i = 0; i < CAP; i++) {
            const r = await tryConsume(uid, u.email);
            expect(r.allowed).toBe(true);
        }
        const over = await tryConsume(uid, u.email);
        expect(over.allowed).toBe(false);
        expect(over.remaining).toBe(0);
        // HTTP layer returns the stable code
        const res = await request(app).post("/api/v1/chat/message").set(auth(u.token)).send({ message: "hi" });
        expect(res.status).toBe(429);
        expect(res.body.code).toBe("AI_USER_CAP_REACHED");
        // status() reports 0 remaining
        const st = await status(uid, u.email);
        expect(st.remaining).toBe(0);
        expect(st.used).toBe(CAP);
    });

    it("admin emails are exempt", async () => {
        const u = await createUser();
        const uid = (await mongoose.model("User").findOne({ email: u.email }))._id;
        const old = process.env.ADMIN_EMAILS;
        process.env.ADMIN_EMAILS = u.email;
        try {
            for (let i = 0; i < CAP + 5; i++) {
                const r = await tryConsume(uid, u.email);
                expect(r.allowed).toBe(true);
            }
        } finally {
            if (old === undefined) delete process.env.ADMIN_EMAILS; else process.env.ADMIN_EMAILS = old;
        }
    });

    it("concurrent consumers cannot oversell the cap", async () => {
        const u = await createUser();
        const uid = (await mongoose.model("User").findOne({ email: u.email }))._id;
        const results = await Promise.all(
            Array.from({ length: CAP + 10 }, () => tryConsume(uid, u.email))
        );
        expect(results.filter((r) => r.allowed).length).toBe(CAP);
        expect(results.filter((r) => !r.allowed).length).toBe(10);
    });
});
