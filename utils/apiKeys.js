/**
 * utils/apiKeys.js — Phase 5.4 public API keys.
 *
 * Key format: qk_<43 chars of base64url from 32 random bytes>.
 * Only the SHA-256 hash and a display prefix are ever persisted — the
 * plaintext exists in memory for exactly one response at creation.
 *
 * Limits: 30 requests / 15 min per key (in-process), API_KEY_DAILY_CAP/day
 * per key, and every call counts toward the OWNER's USER_DAILY_AI_CAP.
 */
const crypto = require("crypto");
const ApiKey = require("../models/ApiKey");

const MAX_KEYS = () => parseInt(process.env.API_KEY_MAX_ACTIVE || "5", 10);
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX = () => parseInt(process.env.API_KEY_RATE_MAX || "30", 10);
const DAILY_CAP = () => parseInt(process.env.API_KEY_DAILY_CAP || "100", 10);

const generateKey = () => `qk_${crypto.randomBytes(32).toString("base64url")}`;
const hashKey = (key) => crypto.createHash("sha256").update(String(key)).digest("hex");

/** Timing-safe hash comparison (hex strings, same length). */
function hashEquals(a, b) {
    const ba = Buffer.from(String(a), "utf8");
    const bb = Buffer.from(String(b), "utf8");
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
}

/**
 * Resolve a Bearer key to its ApiKey doc (and owner). Rejects malformed,
 * unknown, and revoked keys — callers return 401 for all three identically.
 */
async function resolveKey(key) {
    if (typeof key !== "string" || !/^qk_[A-Za-z0-9_-]{20,}$/.test(key)) return null;
    const target = hashKey(key);
    // Lookup by hash (unique index) then timing-safe confirm — belt and braces
    // against any future non-hex hash storage.
    const doc = await ApiKey.findOne({ hash: target }).lean();
    if (!doc || !hashEquals(doc.hash, target) || doc.revokedAt) return null;
    return doc;
}

// ---- Per-key limits (in-process buckets; keyed by key id, not IP) ----
const rateBuckets = new Map(); // keyId -> {start, count}
const dayBuckets = new Map();  // `${keyId}:${day}` -> count

function checkRate(keyId) {
    const now = Date.now();
    let b = rateBuckets.get(keyId);
    if (!b || now - b.start > RATE_WINDOW_MS) {
        b = { start: now, count: 0 };
        rateBuckets.set(keyId, b);
    }
    if (++b.count > RATE_MAX()) return { allowed: false, reason: "rate" };
    return { allowed: true };
}

function checkDaily(keyId) {
    const day = new Date().toISOString().slice(0, 10);
    const k = `${keyId}:${day}`;
    const count = (dayBuckets.get(k) || 0) + 1;
    dayBuckets.set(k, count);
    const cap = DAILY_CAP();
    return count <= cap ? { allowed: true, remaining: cap - count } : { allowed: false, reason: "daily" };
}

// Sweep stale buckets hourly so the maps stay bounded
setInterval(() => {
    const now = Date.now();
    for (const [k, b] of rateBuckets) if (now - b.start > RATE_WINDOW_MS) rateBuckets.delete(k);
    const today = new Date().toISOString().slice(0, 10);
    for (const k of dayBuckets.keys()) if (!k.endsWith(today)) dayBuckets.delete(k);
}, 60 * 60 * 1000).unref?.();

function touchUsed(id) {
    ApiKey.updateOne({ _id: id }, { $set: { lastUsedAt: new Date() } }).catch(() => {});
}

module.exports = { MAX_KEYS, RATE_MAX, DAILY_CAP, generateKey, hashKey, hashEquals, resolveKey, checkRate, checkDaily, touchUsed };
