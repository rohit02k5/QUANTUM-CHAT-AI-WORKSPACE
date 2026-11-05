/**
 * scripts/backfill-chat-summaries.js — generate + embed summaries for all
 * chats missing them (Phase 4.5). Safe to re-run:
 *   - resumable:  a cursor file tracks the last processed chat _id
 *   - idempotent: needsSummary() gates every chat; writes are $set upserts
 *   - rate-limited: BACKFILL_PACE_MS between chats
 *   - quota-aware:  stops cleanly on daily-quota exhaustion (4.0b) —
 *                   re-run after reset; it resumes where it stopped
 *   - --dry-run:    report what WOULD be summarized, write nothing
 *
 * Usage:
 *   node scripts/backfill-chat-summaries.js [--dry-run] [--user <id>]
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const Chat = require("../models/Chat");
const geminiHelper = require("../utils/geminiHelper");
const { maybeSummarizeChat, needsSummary } = require("../utils/chatSummary");
const { classifyError } = geminiHelper;

const CURSOR_FILE = path.join(__dirname, "..", "evals", ".summary-backfill.cursor");
const PACE_MS = parseInt(process.env.BACKFILL_PACE_MS || "2000", 10);
const DRY_RUN = process.argv.includes("--dry-run");
const userArg = process.argv.find((a, i) => a === "--user" && process.argv[i + 1]);

async function main() {
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) { console.error("MONGO_URI not set"); process.exit(1); }
    await mongoose.connect(mongoUri);

    const query = {};
    if (userArg) {
        const i = process.argv.indexOf("--user");
        query.user = process.argv[i + 1];
    }
    // Resume from cursor
    let cursor;
    try { cursor = fs.readFileSync(CURSOR_FILE, "utf8").trim() || undefined; } catch { /* none */ }
    if (cursor && mongoose.Types.ObjectId.isValid(cursor)) query._id = { $gt: cursor };

    const chats = await Chat.find(query)
        .select("user title messages summary summaryMessageCount")
        .sort({ _id: 1 })
        .lean();

    let scanned = 0, needed = 0, done = 0, quotaStopped = false;
    for (const chat of chats) {
        scanned++;
        if (!needsSummary(chat)) continue;
        needed++;
        if (DRY_RUN) {
            console.log(`[dry-run] would summarize ${chat._id} "${chat.title}" (${chat.messages.length} msgs)`);
            continue;
        }
        try {
            const wrote = await maybeSummarizeChat(chat._id);
            if (wrote) done++;
        } catch (e) {
            const cls = classifyError(e);
            if (cls.kind === "daily-quota") {
                console.error(`Daily AI quota exhausted (${cls.code}) — stopping. Re-run after reset; resume cursor saved.`);
                quotaStopped = true;
                break;
            }
            console.error(`Failed ${chat._id}: ${e.message}`);
        }
        try { fs.mkdirSync(path.dirname(CURSOR_FILE), { recursive: true }); fs.writeFileSync(CURSOR_FILE, String(chat._id)); } catch { /* non-fatal */ }
        await new Promise((r) => setTimeout(r, PACE_MS));
    }

    console.log(`scanned=${scanned} needed=${needed} summarized=${done} quotaStopped=${quotaStopped}`);
    if (scanned === chats.length && chats.length) {
        try { fs.unlinkSync(CURSOR_FILE); } catch { /* finished — clear cursor */ }
    }
    await mongoose.disconnect();
    process.exit(quotaStopped ? 2 : 0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
