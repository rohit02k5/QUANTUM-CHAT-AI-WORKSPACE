// Runs before every test file. Spins up an in-memory MongoDB and points the
// app at it, with a mocked Gemini (no API key or network needed).
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");

process.env.NODE_ENV = "test";
process.env.GEMINI_MOCK = "1";
process.env.JWT_ACCESS_SECRET = "test-access-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
process.env.JWT_ACCESS_EXPIREIN = "1h";
process.env.JWT_REFRESH_EXPIREIN = "7d";
process.env.CLIENT_URL = "http://localhost:3000";
process.env.EMBEDDING_DIMS = "768";

let mongod;

beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongod.getUri("quantum-test");
    await mongoose.connect(process.env.MONGO_URI);
}, 60000);

afterAll(async () => {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
});
