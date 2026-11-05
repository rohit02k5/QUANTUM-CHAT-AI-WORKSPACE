/**
 * demo.test.js — Phase 6.4 demo mode: session issuance, restrictions,
 * recorded-replay schema, reseed idempotency, isolation.
 */
const { request, app, createUser, auth } = require("./helpers");
const mongoose = require("mongoose");

const DEMO_EMAIL = process.env.DEMO_USER_EMAIL || "demo@quantum.local";

function parseSse(text) {
    return String(text)
        .split("\n\n")
        .filter((b) => b.startsWith("data:"))
        .map((b) => JSON.parse(b.slice(5).trim()));
}

describe("demo mode (6.4)", () => {
    test("demo login is refused when DEMO_MODE is off", async () => {
        delete process.env.DEMO_MODE;
        const res = await request(app).post("/api/v1/auth/demo");
        expect(res.status).toBe(403);
        const st = await request(app).get("/api/v1/auth/demo-status");
        expect(st.body.enabled).toBe(false);
    });

    test("demo login issues a session for the seeded demo account", async () => {
        process.env.DEMO_MODE = "true";
        const res = await request(app).post("/api/v1/auth/demo");
        expect(res.status).toBe(200);
        expect(res.body.token).toBeTruthy();
        const me = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${res.body.token}`);
        expect(me.status).toBe(200);
        const user = await require("../models/userModel").findOne({ email: DEMO_EMAIL });
        expect(user.isDemo).toBe(true);
    });

    test("demo restrictions: no uploads, keys, account deletion, delete-token", async () => {
        process.env.DEMO_MODE = "true";
        const login = await request(app).post("/api/v1/auth/demo");
        const t = { Authorization: `Bearer ${login.body.token}` };

        const up = await request(app).post("/api/v1/files/upload").set(t).attach("file", Buffer.from("x"), "x.txt");
        expect(up.status).toBe(403);
        const key = await request(app).post("/api/v1/keys").set(t).send({ name: "k" });
        expect(key.status).toBe(403);
        const del = await request(app).delete("/api/v1/auth/account").set(t).send({ password: "x" });
        expect(del.status).toBe(403);
        const tok = await request(app).post("/api/v1/auth/account/delete-token").set(t);
        expect(tok.status).toBe(403);
    });

    test("demo daily AI cap is much lower than normal", async () => {
        process.env.DEMO_MODE = "true";
        const login = await request(app).post("/api/v1/auth/demo");
        const me = await request(app).get("/api/v1/usage/me").set("Authorization", `Bearer ${login.body.token}`);
        expect(me.status).toBe(200);
        const cap = me.body.dailyCap || me.body.cap || {};
        const limit = cap.limit ?? cap.dailyCap?.limit;
        expect(limit).toBeLessThanOrEqual(20);
    });

    test("recorded replay emits the same event schema as live streaming", async () => {
        process.env.DEMO_MODE = "true";
        const login = await request(app).post("/api/v1/auth/demo");
        const res = await request(app)
            .get("/api/v1/demo/replay/cited-rag")
            .set("Authorization", `Bearer ${login.body.token}`);
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toContain("text/event-stream");
        const events = parseSse(res.text);
        const types = events.map((e) => e.type);
        expect(types[0]).toBe("meta");
        expect(types).toContain("token");
        expect(types[types.length - 1]).toBe("done");
        // labelled as replay on every event, never presented as live
        expect(events.every((e) => e.replay === true)).toBe(true);
        const done = events.find((e) => e.type === "done");
        expect(done.truncated).toBe(false);
    });

    test("agent replay includes tool_call/tool_result events like a live run", async () => {
        process.env.DEMO_MODE = "true";
        const login = await request(app).post("/api/v1/auth/demo");
        const res = await request(app)
            .get("/api/v1/demo/replay/agent-trace")
            .set("Authorization", `Bearer ${login.body.token}`);
        const events = parseSse(res.text);
        const types = events.map((e) => e.type);
        expect(types).toContain("tool_call");
        expect(types).toContain("tool_result");
        expect(types.indexOf("tool_call")).toBeLessThan(types.indexOf("done"));
    });

    test("reseed is idempotent and zero-AI", async () => {
        process.env.DEMO_MODE = "true";
        const login = await request(app).post("/api/v1/auth/demo");
        const user = await require("../models/userModel").findOne({ email: DEMO_EMAIL });
        const { seedDemo } = require("../scripts/seed-demo");
        const Chunk = require("../models/Chunk");
        const File = require("../models/File");
        const r1 = await seedDemo(user._id);
        const n1 = await Chunk.countDocuments({ user: user._id });
        const r2 = await seedDemo(user._id);
        const n2 = await Chunk.countDocuments({ user: user._id });
        expect(n2).toBe(n1);
        expect(n1).toBeGreaterThan(0);
        expect(r1.files).toBe(r2.files);
        // embeddings come from the committed snapshot — same dims as active profile
        const any = await Chunk.findOne({ user: user._id });
        expect(any.embeddingDims).toBe(parseInt(process.env.EMBEDDING_DIMS || "768", 10));
    });

    test("demo user cannot reach other users' data", async () => {
        process.env.DEMO_MODE = "true";
        const login = await request(app).post("/api/v1/auth/demo");
        const other = await createUser({ username: "demo-other", email: "demo-other@test.dev" });
        const Chat = require("../models/Chat");
        const uid = (await require("../models/userModel").findOne({ email: "demo-other@test.dev" }))._id;
        const chat = await Chat.create({ user: uid, title: "private", messages: [{ role: "user", content: "hi" }] });
        const res = await request(app).get(`/api/v1/chat/${chat._id}`).set("Authorization", `Bearer ${login.body.token}`);
        expect(res.status).toBe(404);
    });
});
