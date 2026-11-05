// Phase 6B — degraded modes: extractive fallback, keyword-only retrieval,
// EmbeddingCache isolation + cascade.
const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../app");
const llm = require("../utils/llm");
const { CAP } = require("../utils/llm/capabilities");
const { buildExtractiveReply } = require("../utils/extractive");
const ec = require("../utils/embeddingCache");

const err = (status, message) => Object.assign(new Error(message), { status });

function deadProvider(name) {
    return {
        name,
        enabled: true,
        capabilities: new Set([CAP.GENERATE, CAP.STREAM, CAP.TOOLS]),
        async generate() { throw err(503, "Overloaded"); },
        async openStream() { throw err(503, "Overloaded"); },
        async listModels() { return new Set(["m1"]); },
    };
}

const { createUser } = require("./helpers");

async function registerUser(email) {
    const u = await createUser({ email });
    const user = await require("../models/userModel").findOne({ email });
    return { token: u.token, userId: user._id };
}

async function seedRetrievableChunk(userId) {
    const File = require("../models/File");
    const Chunk = require("../models/Chunk");
    const file = await File.create({
        user: userId, filename: "policy.txt", originalName: "policy.txt",
        path: "/tmp/policy.txt", mimetype: "text/plain", kind: "doc", status: "ready",
        content: "Quantum refund policy: refunds are issued within 30 days for annual plans.",
    });
    const chunk = await Chunk.create({
        user: userId, file: file._id,
        text: "Quantum refund policy: refunds are issued within 30 days for annual plans.",
        pageContent: "Quantum refund policy: refunds are issued within 30 days for annual plans.",
        embedding: new Array(768).fill(0.01), embeddingDims: 768,
        embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2",
        type: "text",
    });
    return { file, chunk };
}

async function readSseEvents(res) {
    return String(res.text).split("\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => JSON.parse(l.slice(6)));
}

describe("6B extractive fallback", () => {
    beforeAll(async () => {
        // server.js normally ensures this at boot; tests must do it so the
        // keyword leg (degraded retrieval) has its text index.
        await require("../utils/retriever").ensureTextIndex().catch(() => {});
    });
    beforeEach(() => {
        llm.__resetCircuits();
    });
    afterEach(() => {
        delete process.env.LLM_PROVIDERS;
        llm.__resetCircuits();
    });

    test("all providers down + retrieved sources → degraded extractive reply with citations", async () => {
        llm.__registerProvider("dead", deadProvider("dead"));
        process.env.LLM_PROVIDERS = "dead";
        llm.__setChain("answer", [{ provider: "dead", model: "m1" }]);

        const { token, userId } = await registerUser("deg1@test.dev");
        await seedRetrievableChunk(userId);

        const res = await request(app)
            .post("/api/v1/chat/new/stream")
            .set("Authorization", `Bearer ${token}`)
            .send({ message: "what is the refund policy" });
        expect(res.status).toBe(200);
        const events = await readSseEvents(res);
        const done = events.find((e) => e.type === "done");
        expect(done).toBeDefined();
        expect(done.degraded).toBe(true);
        const tokens = events.filter((e) => e.type === "token").map((e) => e.text).join("");
        expect(tokens).toContain("unavailable");
        expect(tokens).toContain("refund");

        // Persisted message carries degraded:true and the citations
        const chat = await mongoose.model("Chat").findById(done.chatId);
        const last = chat.messages[chat.messages.length - 1];
        expect(last.role).toBe("model");
        expect(last.degraded).toBe(true);
        expect(last.sources.length).toBeGreaterThan(0);
    });

    test("agent mode with no tool-capable provider → friendly refusal + doc list, no crash", async () => {
        llm.__registerProvider("dead", deadProvider("dead"));
        process.env.LLM_PROVIDERS = "dead";
        llm.__setChain("agent", [{ provider: "dead", model: "m1" }]);

        const { token, userId } = await registerUser("deg2@test.dev");
        await seedRetrievableChunk(userId);

        const res = await request(app)
            .post("/api/v1/chat/new/stream")
            .set("Authorization", `Bearer ${token}`)
            .send({ message: "list my docs", mode: "agent" });
        expect(res.status).toBe(200);
        const events = await readSseEvents(res);
        const done = events.find((e) => e.type === "done");
        expect(done?.degraded).toBe(true);
        const tokens = events.filter((e) => e.type === "token").map((e) => e.text).join("");
        expect(tokens).toContain("unavailable");
        expect(tokens).toContain("policy.txt");
    });

    test("non-streaming path: degraded reply returns 200, not 500", async () => {
        llm.__registerProvider("dead", deadProvider("dead"));
        process.env.LLM_PROVIDERS = "dead";
        llm.__setChain("answer", [{ provider: "dead", model: "m1" }]);

        const { token, userId } = await registerUser("deg3@test.dev");
        await seedRetrievableChunk(userId);

        const res = await request(app)
            .post("/api/v1/chat/message")
            .set("Authorization", `Bearer ${token}`)
            .send({ message: "refund policy?" });
        expect(res.status).toBe(200);
        expect(res.body.degraded).toBe(true);
        expect(res.body.response).toContain("refund");
        expect(res.body.sources.length).toBeGreaterThan(0);
    });
});

describe("6B buildExtractiveReply", () => {
    test("labels and cites; null for empty sources", () => {
        expect(buildExtractiveReply([])).toBeNull();
        const r = buildExtractiveReply([
            { originalName: "a.pdf", page: 3, snippet: "the answer passage" },
        ]);
        expect(r).toContain("unavailable");
        expect(r).toContain("a.pdf");
        expect(r).toContain("page 3");
    });
});

describe("6B EmbeddingCache", () => {
    test("lookup/store round-trip and per-user isolation", async () => {
        const EmbeddingCache = require("../models/EmbeddingCache");
        const uA = new mongoose.Types.ObjectId();
        const uB = new mongoose.Types.ObjectId();
        const profile = { model: "m", dims: 768, taskType: "document" };
        await ec.store(uA, [{ text: "hello world", vector: [0.1, 0.2] }], profile);
        const hitsA = await ec.lookup(uA, ["hello world"], profile);
        expect(hitsA.get(0)).toEqual([0.1, 0.2]);
        const hitsB = await ec.lookup(uB, ["hello world"], profile);
        expect(hitsB.size).toBe(0); // never crosses users
        // different profile → different hash → miss
        const misses = await ec.lookup(uA, ["hello world"], { ...profile, model: "other" });
        expect(misses.size).toBe(0);
        await EmbeddingCache.deleteMany({});
    });

    test("cascade deletes EmbeddingCache rows", async () => {
        const EmbeddingCache = require("../models/EmbeddingCache");
        const { cascadeDelete } = require("../utils/accountCascade");
        const u = new mongoose.Types.ObjectId();
        await ec.store(u, [{ text: "x", vector: [1] }], { model: "m", dims: 768 });
        const deleted = await cascadeDelete(u);
        expect(await EmbeddingCache.countDocuments({ user: u })).toBe(0);
    });
});
