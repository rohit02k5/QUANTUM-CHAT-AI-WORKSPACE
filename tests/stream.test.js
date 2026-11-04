const http = require("http");
const { request, app, createUser, auth } = require("./helpers");
const Chat = require("../models/Chat");
const mongoose = require("mongoose");

/** Parse `data: {json}` SSE events out of a raw response body. */
function parseSSE(body) {
    return body
        .split("\n\n")
        .filter((block) => block.startsWith("data:"))
        .map((block) => JSON.parse(block.slice(5).trim()));
}

describe("streaming chat POST /api/v1/chat/:chatId/stream", () => {
    it("streams meta -> tokens -> done and persists a normal-shaped message", async () => {
        const u = await createUser();
        const res = await request(app)
            .post("/api/v1/chat/new/stream")
            .set(auth(u.token))
            .send({ message: "hello there" });

        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toContain("text/event-stream");
        expect(res.headers["x-accel-buffering"]).toBe("no");

        const events = parseSSE(res.text);
        expect(events[0].type).toBe("meta");
        expect(events[0].chatId).toBeTruthy();

        const tokens = events.filter((e) => e.type === "token");
        expect(tokens.length).toBeGreaterThan(0);
        const joined = tokens.map((t) => t.text).join("");

        const done = events[events.length - 1];
        expect(done.type).toBe("done");
        expect(done.truncated).toBe(false);
        expect(done.messageId).toBeTruthy();

        // Stored message must match the non-stream shape exactly
        const chat = await Chat.findById(done.chatId);
        const last = chat.messages[chat.messages.length - 1];
        expect(last.role).toBe("model");
        expect(last.content).toBe(joined);
        expect(last.truncated).toBe(false);
        expect(last.timestamp).toBeTruthy();
    });

    it("rejects without a token (401)", async () => {
        const res = await request(app).post("/api/v1/chat/new/stream").send({ message: "hi" });
        expect(res.status).toBe(401);
    });

    it("returns 404 for another user's chat", async () => {
        const a = await createUser();
        const b = await createUser();
        const aUser = await mongoose.connection.collection("users").findOne({ email: a.email });
        const chat = await Chat.create({ user: aUser._id, title: "A", messages: [{ role: "user", content: "x" }] });

        const res = await request(app)
            .post(`/api/v1/chat/${chat._id}/stream`)
            .set(auth(b.token))
            .send({ message: "hi" });
        expect(res.status).toBe(404);
    });

    it("persists a truncated partial message when the client disconnects", async () => {
        const u = await createUser();
        const server = app.listen(0);
        await new Promise((r) => server.once("listening", r));
        const port = server.address().port;

        // Raw socket request so we can destroy mid-stream
        const req = http.request({
            hostname: "127.0.0.1",
            port,
            path: "/api/v1/chat/new/stream",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${u.token}`,
            },
        });
        req.end(JSON.stringify({ message: "tell me a long story" }));

        let body = "";
        let chatId = null;
        await new Promise((resolve, reject) => {
            req.on("response", (res) => {
                res.on("data", (chunk) => {
                    body += chunk.toString();
                    if (!chatId) {
                        const m = body.match(/"chatId":"([a-f0-9]+)"/);
                        if (m) chatId = m[1];
                    }
                    // Destroy as soon as we have meta + at least one token
                    if (chatId && body.includes('"type":"token"')) {
                        req.destroy();
                        resolve();
                    }
                });
            });
            req.on("error", () => resolve()); // expected: destroyed socket
            setTimeout(() => reject(new Error("timed out waiting for first token")), 15000);
        });
        server.close();

        // Give the server a moment to persist the truncated message
        await new Promise((r) => setTimeout(r, 800));
        const chat = await Chat.findById(chatId);
        const last = chat.messages[chat.messages.length - 1];
        expect(last.role).toBe("model");
        expect(last.truncated).toBe(true);
        expect(last.content.length).toBeGreaterThan(0);
    });
});
