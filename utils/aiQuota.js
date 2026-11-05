/**
 * aiQuota.js — per-user daily AI-request cap (Phase 5.0d).
 *
 * The project shares one Gemini free-tier key whose quotas are per-model and
 * tiny (~20/day on some models). A single user (or a compromised client)
 * could burn the whole day's budget for everyone, so each authenticated
 * user gets USER_DAILY_AI_CAP AI requests per UTC day. One request counts
 * once regardless of internal model calls — an agent run is one request.
 *
 * ADMIN_EMAILS accounts are exempt. Over the cap → 429 with the stable code
 * AI_USER_CAP_REACHED plus a UsageEvent errorCode so it shows in telemetry.
 */
const DailyAiQuota = require("../models/DailyAiQuota");
const logger = require("./logger");

const CAP = parseInt(process.env.USER_DAILY_AI_CAP || "60", 10);

function todayUTC() {
    return new Date().toISOString().slice(0, 10);
}

function dayExpiry() {
    const d = new Date();
    d.setUTCHours(24, 0, 30, 0); // a little after midnight UTC
    return d;
}

function isAdmin(email) {
    const admins = (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    return !!email && admins.includes(String(email).toLowerCase());
}

/**
 * Atomically consume n requests for today. Returns {allowed, used, remaining}.
 * The conditional update keeps concurrency honest: a doc only grows while
 * under the cap.
 */
async function tryConsume(userId, email, { n = 1 } = {}) {
    if (CAP <= 0 || isAdmin(email)) {
        return { allowed: true, used: 0, remaining: Infinity, exempt: CAP <= 0 ? "disabled" : "admin" };
    }
    const day = todayUTC();
    let doc;
    try {
        doc = await DailyAiQuota.findOneAndUpdate(
            { user: userId, day, count: { $lt: CAP } },
            { $inc: { count: n }, $setOnInsert: { expires: dayExpiry() } },
            { upsert: true, new: true }
        );
    } catch (err) {
        // count >= CAP: no doc matches, the upsert collides with the unique
        // {user,day} index → duplicate-key means "at cap", not an error.
        if (err.code !== 11000) throw err;
    }
    if (!doc) {
        const used = (await DailyAiQuota.findOne({ user: userId, day }).select("count").lean())?.count ?? CAP;
        return { allowed: false, used, remaining: 0 };
    }
    return { allowed: true, used: doc.count, remaining: Math.max(0, CAP - doc.count) };
}

async function status(userId, email) {
    if (CAP <= 0 || isAdmin(email)) {
        return { limit: CAP <= 0 ? null : CAP, used: 0, remaining: null, exempt: CAP <= 0 ? "disabled" : "admin" };
    }
    const doc = await DailyAiQuota.findOne({ user: userId, day: todayUTC() }).select("count").lean();
    const used = doc?.count || 0;
    return { limit: CAP, used, remaining: Math.max(0, CAP - used) };
}

/**
 * Express middleware — applies AFTER requireSignIn (needs req.user).
 * 429 {code:"AI_USER_CAP_REACHED"} + UsageEvent errorCode when over.
 */
async function dailyAiCap(req, res, next) {
    try {
        const r = await tryConsume(req.user._id, req.user.email);
        res.set("X-AI-Daily-Remaining", String(r.remaining === Infinity ? "inf" : r.remaining));
        if (!r.allowed) {
            require("../models/UsageEvent").create({
                user: req.user._id, kind: "chat", ok: false,
                errorCode: "AI_USER_CAP_REACHED",
                requestId: req.requestId,
            }).catch(() => {});
            return res.status(429).json({
                code: "AI_USER_CAP_REACHED",
                message: "You've reached today's AI request limit. It resets at midnight UTC — try again then, or ask an admin for a higher cap.",
            });
        }
        next();
    } catch (err) {
        // Quota bookkeeping must never take the product down
        logger.warn({ err: err.message }, "[aiQuota] cap check failed — allowing request");
        next();
    }
}

module.exports = { CAP, tryConsume, status, isAdmin, dailyAiCap };
