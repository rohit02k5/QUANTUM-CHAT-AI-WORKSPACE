/**
 * seed-demo.js — Phase 6.4 demo seeder (ZERO AI calls — reads the committed
 * snapshot generated once by scripts/gen-demo-seed.js).
 *
 *   node scripts/seed-demo.js            # reseed the demo user (idempotent)
 *
 * Idempotent: wipes the demo user's demo-seeded collections and re-inserts
 * from scripts/demo-seed.snapshot.json. Other users are never touched.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

const SNAPSHOT = path.join(__dirname, "demo-seed.snapshot.json");
const DEMO_EMAIL = process.env.DEMO_USER_EMAIL || "demo@quantum.local";

async function seedDemo(userId) {
    const File = require("../models/File");
    const Chunk = require("../models/Chunk");
    const Memory = require("../models/Memory");
    const Deck = require("../models/Deck");
    const Card = require("../models/Card");
    const Chat = require("../models/Chat");
    const ReviewLog = require("../models/ReviewLog");

    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
    const { embeddingModel, embeddingDims } = snap.meta;

    // wipe only the demo user's seeded collections
    await Promise.all([
        File.deleteMany({ user: userId }),
        Chunk.deleteMany({ user: userId }),
        Memory.deleteMany({ user: userId }),
        Deck.deleteMany({ user: userId }),
        Card.deleteMany({ user: userId }),
        ReviewLog.deleteMany({ user: userId }),
        Chat.deleteMany({ user: userId }),
    ]);

    const fileIds = {};
    for (const f of snap.files) {
        const doc = await File.create({
            user: userId,
            filename: f.originalName,
            originalName: f.originalName,
            mimetype: f.mimetype,
            status: "ready",
            content: f.content,
            size: Buffer.byteLength(f.content),
        });
        fileIds[f.originalName] = doc._id;
        await Chunk.insertMany(f.chunks.map((c) => ({
            user: userId,
            file: doc._id,
            text: c.text,
            pageContent: c.text,
            embedding: c.embedding,
            embeddingModel,
            embeddingDims,
            type: "text",
        })));
    }

    for (const m of snap.memories) {
        await Memory.create({
            user: userId,
            text: m.text,
            embedding: m.embedding,
            embeddingModel,
            embeddingDims,
            category: "fact",
        });
    }

    if (snap.deck) {
        const deck = await Deck.create({ user: userId, name: snap.deck.name });
        const now = Date.now();
        await Card.insertMany(snap.deck.cards.map((c, i) => ({
            user: userId,
            deck: deck._id,
            front: c.front,
            back: c.back,
            // half due now, half due tomorrow — a review session works immediately
            due: new Date(now + (i % 2 ? 86400000 : 0)),
        })));
    }

    for (const c of snap.chats || []) {
        await Chat.create({
            user: userId,
            title: c.title,
            messages: c.messages.map((m) => ({ ...m, timestamp: new Date() })),
        });
    }

    return { files: Object.keys(fileIds).length, fileIds };
}

async function main() {
    const uri = process.env.MONGO_URI;
    if (!uri) { console.error("MONGO_URI required"); process.exit(1); }
    await mongoose.connect(uri);
    const User = require("../models/userModel");
    const user = await User.findOneAndUpdate(
        { email: DEMO_EMAIL },
        { $setOnInsert: { username: "demo", email: DEMO_EMAIL, password: require("crypto").randomBytes(24).toString("hex") }, $set: { isDemo: true } },
        { upsert: true, new: true }
    );
    const r = await seedDemo(user._id);
    console.log(`[seed-demo] seeded ${r.files} files for ${DEMO_EMAIL}`);
    await mongoose.disconnect();
}

module.exports = { seedDemo, DEMO_EMAIL };
if (require.main === module) {
    main().catch((e) => { console.error("[seed-demo] fatal:", e.message); process.exit(1); });
}
