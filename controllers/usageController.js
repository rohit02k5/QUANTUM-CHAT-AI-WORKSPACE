const UsageEvent = require("../models/UsageEvent");

function percentile(sorted, p) {
    if (!sorted.length) return 0;
    const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[idx];
}

// GET /api/v1/usage/me — last-30-day totals for the requesting user
exports.myUsage = async (req, res) => {
    try {
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const events = await UsageEvent.find({ user: req.user._id, createdAt: { $gte: since } })
            .select("kind model promptTokens outputTokens latencyMs ok createdAt")
            .lean();

        const byKind = {};
        const byModel = {};
        const byDay = {};
        const latencies = [];
        let promptTokens = 0, outputTokens = 0, failures = 0;

        for (const e of events) {
            byKind[e.kind] = (byKind[e.kind] || 0) + 1;
            byModel[e.model] = (byModel[e.model] || 0) + 1;
            const day = e.createdAt.toISOString().slice(0, 10);
            byDay[day] = (byDay[day] || 0) + 1;
            promptTokens += e.promptTokens || 0;
            outputTokens += e.outputTokens || 0;
            if (e.ok === false) failures++;
            if (e.latencyMs) latencies.push(e.latencyMs);
        }
        latencies.sort((a, b) => a - b);

        res.status(200).json({
            windowDays: 30,
            totalEvents: events.length,
            promptTokens,
            outputTokens,
            failures,
            latency: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
            byKind,
            byModel,
            daily: Object.entries(byDay).sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, count]) => ({ date, count })),
            dailyCap: await require("../utils/aiQuota").status(req.user._id, req.user.email),
        });
    } catch (err) {
        res.status(500).json({ message: "Usage query failed" });
    }
};

// GET /api/v1/usage/admin — platform totals; gated by ADMIN_EMAILS
exports.adminUsage = async (req, res) => {
    try {
        const admins = (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
        if (!admins.length || !admins.includes(req.user.email.toLowerCase())) {
            return res.status(403).json({ message: "Forbidden" });
        }
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const [totals, topUsers] = await Promise.all([
            UsageEvent.aggregate([
                { $match: { createdAt: { $gte: since } } },
                { $group: { _id: "$kind", count: { $sum: 1 }, promptTokens: { $sum: "$promptTokens" }, outputTokens: { $sum: "$outputTokens" } } },
            ]),
            UsageEvent.aggregate([
                { $match: { createdAt: { $gte: since } } },
                { $group: { _id: "$user", count: { $sum: 1 }, tokens: { $sum: { $add: ["$promptTokens", "$outputTokens"] } } } },
                { $sort: { count: -1 } },
                { $limit: 10 },
            ]),
        ]);
        res.status(200).json({ windowDays: 30, totals, topUsers });
    } catch (err) {
        res.status(500).json({ message: "Usage query failed" });
    }
};
