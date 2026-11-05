// Runs before every test file. Spins up an in-memory MongoDB and points the
// app at it, with a mocked Gemini (no API key or network needed).
const path = require("path");
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
// CI stability: pin the mongod binary version, cache downloads in the repo's
// .cache dir (cached by actions/cache), and give startup a generous window.
process.env.MONGOMS_VERSION = process.env.MONGOMS_VERSION || "8.2.6";
process.env.MONGOMS_DOWNLOAD_DIR =
    process.env.MONGOMS_DOWNLOAD_DIR || path.join(__dirname, "../.cache/mongodb-binaries");
process.env.MONGOMS_STARTUP_TIMEOUT = process.env.MONGOMS_STARTUP_TIMEOUT || "60000";

let mongod;

beforeAll(async () => {
    let lastErr;
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            mongod = await MongoMemoryServer.create();
            break;
        } catch (e) {
            lastErr = e;
            console.warn(`[test] mongodb-memory-server start attempt ${attempt} failed: ${e.message}`);
        }
    }
    if (!mongod) throw lastErr;
    process.env.MONGO_URI = mongod.getUri("quantum-test");
    await mongoose.connect(process.env.MONGO_URI);
}, 120000);

afterAll(async () => {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
});
