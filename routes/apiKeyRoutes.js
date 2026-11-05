const express = require("express");
const cors = require("cors");
const { requireSignIn } = require("../middlewares/authMiddleware");
const { authLimiter } = require("../middlewares/rateLimits");
const kc = require("../controllers/apiKeyController");

// ---- Key management (JWT, behind authLimiter) ----
const mgmt = express.Router();
mgmt.use(requireSignIn, authLimiter);
mgmt.post("/keys", kc.create);
mgmt.get("/keys", kc.list);
mgmt.delete("/keys/:id", kc.revoke);

// ---- Public endpoint (Bearer-only, tight body limit) ----
// Mounted at /api/v1/public in app.js — the permissive CORS therefore ONLY
// covers /api/v1/public/*; the app-level whitelist is untouched elsewhere.
// Bearer tokens aren't ambient credentials so this is safe.
const pub = express.Router();
pub.use(cors({ origin: true, methods: ["POST", "OPTIONS"], allowedHeaders: ["Content-Type", "Authorization"] }));
pub.use(express.json({ limit: "16kb" }));
pub.post("/chat", kc.publicChat);

module.exports = { mgmt, pub };
