const request = require("supertest");
const app = require("../app");

let counter = 0;

/** Register a fresh user and return { token, refreshToken, user }. */
async function createUser(overrides = {}) {
    counter++;
    const creds = {
        username: `user${counter}`,
        email: `user${counter}@test.dev`,
        password: "password123",
        ...overrides,
    };
    const res = await request(app).post("/api/v1/auth/register").send(creds);
    if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
    return { ...creds, token: res.body.token, refreshToken: res.body.refreshToken };
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

module.exports = { request, app, createUser, auth };
