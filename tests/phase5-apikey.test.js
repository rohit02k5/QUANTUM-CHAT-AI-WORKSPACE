// Phase 5.4: public API keys — creation/list/revoke, Bearer-only public
// chat, isolation, caps, plaintext hygiene, CORS, cascade.
const mongoose = require("mongoose");
const { request, app, createUser, auth } = require("./helpers");
const ApiKey = require("../models/ApiKey");
const File = require("../models/File");
const Chunk = require("../models/Chunk");
const User = require("../models/userModel");
const keys = require("../utils/apiKeys");
const mock = require("../utils/geminiMock");

async function seedReadyFile(userId, name = "doc.pdf", text = "SIM:notes quantum entanglement research notes") {
    const file = await File.create({
        user: userId, filename: name, originalName: name, path: "x",
        mimetype: "application/pdf", content: text, status: "ready",
    });
    await Chunk.create({
        user: userId, file: file._id, text, pageContent: text,
        metadata: { chunkIndex: 0 },
        embedding: await mock.embed(text), embeddingDims: 768,
        embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2",
    });
    return file;
}

describe("5.4 key management", () => {
    it("creates a key shown once; only hash + prefix are stored", async () => {
        const u = await createUser();
        const r = await request(app).post("/api/v1/keys").set(auth(u.token)).send({ name: "ci-bot" });
        expect(r.status).toBe(201);
        expect(r.body.key).toMatch(/^qk_[A-Za-z0-9_-]{20,}$/);
        const doc = await ApiKey.findById(r.body.apiKey._id).lean();
        expect(doc.hash).toBe(keys.hashKey(r.body.key));
        expect(doc.prefix).toBe(r.body.key.slice(0, 8));
        // Plaintext nowhere in the stored document
        expect(JSON.stringify(doc)).not.toContain(r.body.key);
    });

    it("lists keys with prefix/lastUsed and revokes; unknown/revoked keys get 401", async () => {
        const u = await createUser();
        const created = await request(app).post("/api/v1/keys").set(auth(u.token)).send({ name: "k" });
        const plaintext = created.body.key;
        const list = await request(app).get("/api/v1/keys").set(auth(u.token));
        expect(list.body.keys).toHaveLength(1);
        expect(list.body.keys[0].prefix).toBe(plaintext.slice(0, 8));
        expect(list.body.keys[0].hash).toBeUndefined(); // hash never leaves the server

        // Revoke → 401 immediately
        await request(app).delete(`/api/v1/keys/${created.body.apiKey._id}`).set(auth(u.token));
        const res = await request(app).post("/api/v1/public/chat")
            .set("Authorization", `Bearer ${plaintext}`).send({ message: "hi" });
        expect(res.status).toBe(401);

        // Unknown key → 401
        const unknown = await request(app).post("/api/v1/public/chat")
            .set("Authorization", "Bearer qk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").send({ message: "hi" });
        expect(unknown.status).toBe(401);
    });

    it("caps at 5 active keys per user", async () => {
        const u = await createUser();
        for (let i = 0; i < 5; i++) {
            expect((await request(app).post("/api/v1/keys").set(auth(u.token)).send({ name: `k${i}` })).status).toBe(201);
        }
        const sixth = await request(app).post("/api/v1/keys").set(auth(u.token)).send({ name: "too-many" });
        expect(sixth.status).toBe(409);
        expect(sixth.body.code).toBe("KEY_LIMIT");
        // Revoking frees a slot
        const list = await request(app).get("/api/v1/keys").set(auth(u.token));
        await request(app).delete(`/api/v1/keys/${list.body.keys[0]._id}`).set(auth(u.token));
        expect((await request(app).post("/api/v1/keys").set(auth(u.token)).send({ name: "six" })).status).toBe(201);
    });

    it("key management requires JWT — Bearer is not a substitute", async () => {
        const u = await createUser();
        const created = await request(app).post("/api/v1/keys").set(auth(u.token)).send({ name: "k" });
        const res = await request(app).get("/api/v1/keys").set("Authorization", `Bearer ${created.body.key}`);
        expect(res.status).toBe(401); // API keys can't manage keys
    });
});

describe("5.4 public chat", () => {
    it("answers over the owner's READY files with citations, no cookie needed", async () => {
        const u = await createUser();
        const uid = (await User.findOne({ email: u.email }))._id;
        const file = await seedReadyFile(uid);
        const created = await request(app).post("/api/v1/keys").set(auth(u.token)).send({ name: "pub" });
        const plaintext = created.body.key;

        const res = await request(app).post("/api/v1/public/chat")
            .set("Authorization", `Bearer ${plaintext}`)
            .send({ message: "SIM:notes what do my notes say?", fileIds: [file._id.toString()], topK: 3 });
        expect(res.status).toBe(200);
        expect(res.body.answer).toBeTruthy();
        expect(res.body.sources[0].fileId).toBe(file._id.toString());
        expect(res.body.sources[0].name).toBe("doc.pdf");
        // lastUsedAt recorded
        expect((await ApiKey.findById(created.body.apiKey._id)).lastUsedAt).toBeTruthy();
    });

    it("cross-user isolation — key only reaches its owner's files", async () => {
        const ua = await createUser();
        const ub = await createUser();
        const uidA = (await User.findOne({ email: ua.email }))._id;
        const uidB = (await User.findOne({ email: ub.email }))._id;
        const fileA = await seedReadyFile(uidA, "a-secret.pdf", "user A confidential merger plans");
        await seedReadyFile(uidB, "b-public.pdf", "user B public recipes");

        const keyB = (await request(app).post("/api/v1/keys").set(auth(ub.token)).send({ name: "b" })).body.key;
        const res = await request(app).post("/api/v1/public/chat")
            .set("Authorization", `Bearer ${keyB}`)
            .send({ message: "tell me everything", fileIds: [fileA._id.toString()] });
        expect(res.status).toBe(200);
        // fileA not owned by B → filtered out → no sources leak
        expect(res.body.sources.every((s) => s.fileId !== fileA._id.toString())).toBe(true);
    });

    it("enforces message length cap and malformed requests", async () => {
        const u = await createUser();
        const key = (await request(app).post("/api/v1/keys").set(auth(u.token)).send({ name: "k" })).body.key;
        const long = await request(app).post("/api/v1/public/chat")
            .set("Authorization", `Bearer ${key}`).send({ message: "x".repeat(3000) });
        expect(long.status).toBe(400);
        expect(long.body.code).toBe("MESSAGE_TOO_LONG");
        const empty = await request(app).post("/api/v1/public/chat")
            .set("Authorization", `Bearer ${key}`).send({ message: "  " });
        expect(empty.status).toBe(400);
        // No Bearer at all → 401
        expect((await request(app).post("/api/v1/public/chat").send({ message: "hi" })).status).toBe(401);
        // Cookie session is NOT accepted — Bearer only
        const cookieRes = await request(app).post("/api/v1/public/chat").set(auth(u.token)).send({ message: "hi" });
        expect(cookieRes.status).toBe(401);
    });

    it("per-key rate limit (30/15min) returns 429", async () => {
        const u = await createUser();
        const uid = (await User.findOne({ email: u.email }))._id;
        await seedReadyFile(uid);
        const key = (await request(app).post("/api/v1/keys").set(auth(u.token)).send({ name: "k" })).body.key;
        // Drain the bucket — 30 allowed, 31st rejected
        let last;
        for (let i = 0; i < 31; i++) {
            last = await request(app).post("/api/v1/public/chat")
                .set("Authorization", `Bearer ${key}`).send({ message: "q" });
        }
        expect(last.status).toBe(429);
        expect(last.body.code).toBe("API_KEY_RATE_LIMIT");
    });
});

describe("5.4 CORS + cascade", () => {
    it("public route has permissive CORS; other routes keep the whitelist", async () => {
        // Preflight to /public/chat from a foreign origin → allowed
        const preflight = await request(app)
            .options("/api/v1/public/chat")
            .set("Origin", "https://arbitrary-origin.example")
            .set("Access-Control-Request-Method", "POST");
        expect(preflight.headers["access-control-allow-origin"]).toBeTruthy();

        // Same foreign origin on a NORMAL route → the app whitelist still rejects
        const other = await request(app)
            .get("/api/v1/keys")
            .set("Origin", "https://arbitrary-origin.example");
        expect(other.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("cascade registry covers ApiKey", () => {
        const { userOwnedModels, registeredModels } = require("../utils/accountCascade");
        const registered = new Set(registeredModels());
        for (const m of userOwnedModels()) expect(registered.has(m.modelName)).toBe(true);
        expect(registered.has("ApiKey")).toBe(true);
    });
});
