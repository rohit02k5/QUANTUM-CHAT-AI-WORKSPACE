const { request, app, createUser, auth } = require("./helpers");

describe("auth flows", () => {
    it("registers, rejects duplicate email, rejects bad input", async () => {
        const res = await request(app).post("/api/v1/auth/register").send({
            username: "a1", email: "a1@test.dev", password: "password123",
        });
        expect(res.status).toBe(201);
        expect(res.body.token).toBeTruthy();
        expect(res.body.refreshToken).toBeTruthy();

        const dup = await request(app).post("/api/v1/auth/register").send({
            username: "a1b", email: "a1@test.dev", password: "password123",
        });
        expect(dup.status).toBe(409);

        const bad = await request(app).post("/api/v1/auth/register").send({ email: "x" });
        expect(bad.status).toBe(400);
    });

    it("logs in with correct creds, rejects wrong password", async () => {
        await createUser({ email: "login@test.dev" });
        const ok = await request(app).post("/api/v1/auth/login").send({
            email: "login@test.dev", password: "password123",
        });
        expect(ok.status).toBe(200);
        expect(ok.body.token).toBeTruthy();

        const bad = await request(app).post("/api/v1/auth/login").send({
            email: "login@test.dev", password: "wrong",
        });
        expect(bad.status).toBe(401);
    });

    it("refresh flow: valid refresh token issues a new pair", async () => {
        const user = await createUser();
        const res = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: user.refreshToken });
        expect(res.status).toBe(200);
        expect(res.body.token).toBeTruthy();
        expect(res.body.refreshToken).toBeTruthy();

        // New access token must work on a protected route
        const protectedRes = await request(app)
            .get("/api/v1/chat/history")
            .set(auth(res.body.token));
        expect(protectedRes.status).toBe(200);
    });

    it("rejects garbage and access tokens used as refresh tokens", async () => {
        const user = await createUser();
        const bad = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: "garbage" });
        expect(bad.status).toBe(401);

        const wrongToken = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: user.token });
        expect(wrongToken.status).toBe(401);
    });

    it("protected routes reject missing/invalid tokens", async () => {
        const res = await request(app).get("/api/v1/chat/history");
        expect(res.status).toBe(401);

        const bad = await request(app).get("/api/v1/chat/history").set("Authorization", "Bearer nope");
        expect(bad.status).toBe(401);
    });
});
