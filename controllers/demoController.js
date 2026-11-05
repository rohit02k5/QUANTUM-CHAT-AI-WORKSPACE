/**
 * demoController.js — Phase 6.4 demo mode.
 *
 * POST /api/v1/auth/demo  — issue a session for the dedicated demo user
 *     (only when DEMO_MODE=true). Lazily seeds from the committed snapshot
 *     so a fresh deployment is demo-ready with zero AI calls.
 * GET  /api/v1/demo/replay/:scenario — stream a recorded scenario through
 *     the same SSE format as live chat. Clearly labelled replay, never a
 *     live model call.
 */
const fs = require("fs");
const path = require("path");
const User = require("../models/userModel");
const logger = require("../utils/logger");

const DEMO_EMAIL = process.env.DEMO_USER_EMAIL || "demo@quantum.local";
const REPLAYS = path.join(__dirname, "../scripts/demo-replays.json");
const REPLAY_PACE_MS = parseInt(process.env.DEMO_REPLAY_PACE_MS || "90", 10);

const demoEnabled = () => process.env.DEMO_MODE === "true";
exports.demoEnabled = demoEnabled;

/** GET /api/v1/auth/demo-status — unauthenticated feature probe for the login page. */
exports.demoStatus = (req, res) => res.json({ enabled: demoEnabled() });

/** POST /api/v1/auth/demo — issue demo session tokens. */
exports.demoLogin = async (req, res, next) => {
    try {
        if (!demoEnabled()) {
            return res.status(403).json({ message: "Demo mode is not enabled on this deployment" });
        }
        let user = await User.findOne({ email: DEMO_EMAIL });
        if (!user) {
            user = await User.create({
                username: "demo",
                email: DEMO_EMAIL,
                password: require("crypto").randomBytes(24).toString("hex"),
                isDemo: true,
            });
        } else if (!user.isDemo) {
            user.isDemo = true;
            await user.save();
        }
        // Lazy-seed on first login if the demo user has no documents
        const hasDocs = await require("../models/File").exists({ user: user._id });
        if (!hasDocs) {
            try {
                await require("../scripts/seed-demo").seedDemo(user._id);
            } catch (e) {
                logger.warn({ err: e.message }, "[demo] lazy seed failed — continuing");
            }
        }
        require("./authController").sendToken(user, 200, res);
    } catch (e) {
        next(e);
    }
};

/** Middleware — demo accounts may not use destructive/permanent features. */
exports.denyDemo = (req, res, next) => {
    if (req.user?.isDemo) {
        return res.status(403).json({ code: "DEMO_RESTRICTED", message: "Not available on the demo account" });
    }
    next();
};

/** GET /api/v1/demo/replay/:scenario — SSE stream of recorded events. */
exports.replay = async (req, res) => {
    const scenarioId = req.params.scenario;
    let data;
    try {
        data = JSON.parse(fs.readFileSync(REPLAYS, "utf8"));
    } catch {
        return res.status(500).json({ message: "Replay data unavailable" });
    }
    const scenario = (data.scenarios || []).find((s) => s.id === scenarioId);
    if (!scenario) return res.status(404).json({ message: "Unknown demo scenario" });

    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    require("../utils/sseRegistry").register(res);

    const send = (obj) => {
        if (res.writableEnded) return;
        try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { /* gone */ }
    };

    // Resolve fileKey → the requesting user's seeded file id so citation
    // chips link to real documents when they exist (demo user → snapshot).
    const File = require("../models/File");
    const userFiles = await File.find({ user: req.user._id }).select("originalName").lean();
    const byName = new Map(userFiles.map((f) => [f.originalName, f._id.toString()]));

    let closed = false;
    res.on("close", () => { closed = true; });

    for (const evt of scenario.events) {
        if (closed || res.writableEnded) return;
        const out = { ...evt, replay: true };
        if (out.type === "meta") {
            out.chatId = null;
            out.requestId = req.id;
            if (Array.isArray(out.sources)) {
                out.sources = out.sources.map((s) => {
                    const { fileKey, ...rest } = s;
                    const fid = fileKey && byName.get(fileKey);
                    return fid ? { ...rest, fileId: fid } : rest;
                });
            }
        }
        if (out.type === "done") out.truncated = false;
        send(out);
        if (out.type === "token") await new Promise((r) => setTimeout(r, REPLAY_PACE_MS));
    }
    res.end();
};

/** GET /api/v1/demo/scenarios — list for the UI picker. */
exports.scenarios = (req, res) => {
    try {
        const data = JSON.parse(fs.readFileSync(REPLAYS, "utf8"));
        res.json({ scenarios: (data.scenarios || []).map((s) => ({ id: s.id, label: s.label, prompt: s.prompt })) });
    } catch {
        res.json({ scenarios: [] });
    }
};
