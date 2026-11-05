const rateLimit = require("express-rate-limit");

// Shared rate limiters — app.js mounts them per-route; individual routers
// (files/jobs) apply aiLimiter to AI-costing endpoints like deep-analysis
// and ask-data so they count against the same budget as chat.
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === "test",
    message: { message: "Too many attempts, please try again later" },
});

const aiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: parseInt(process.env.AI_RATE_MAX || "100", 10),
    standardHeaders: true,
    legacyHeaders: false,
    // Disabled in tests unless TEST_RATE_LIMIT=1 (see tests/ratelimit.test.js)
    skip: () => process.env.NODE_ENV === "test" && process.env.TEST_RATE_LIMIT !== "1",
    message: { message: "AI rate limit exceeded, please slow down" },
});

module.exports = { authLimiter, aiLimiter };
