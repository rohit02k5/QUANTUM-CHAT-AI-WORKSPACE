// Verify the AI rate limiter actually guards the stream endpoint.
// AI_RATE_MAX + TEST_RATE_LIMIT must be set BEFORE the app module loads.
process.env.TEST_RATE_LIMIT = "1";
process.env.AI_RATE_MAX = "2";

const { request, app, createUser, auth } = require("./helpers");

describe("AI rate limiter on streaming endpoint", () => {
    it("429s after AI_RATE_MAX requests", async () => {
        const u = await createUser();
        for (let i = 0; i < 2; i++) {
            const ok = await request(app)
                .post("/api/v1/chat/new/stream")
                .set(auth(u.token))
                .send({ message: `msg ${i}` });
            expect(ok.status).toBe(200);
        }
        const blocked = await request(app)
            .post("/api/v1/chat/new/stream")
            .set(auth(u.token))
            .send({ message: "too many" });
        expect(blocked.status).toBe(429);
    });
});
