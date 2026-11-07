const express = require("express");
const dotenv = require("dotenv");
dotenv.config();
const cors = require("cors");
const bodyParser = require("body-parser");
const { authLimiter, aiLimiter } = require("./middlewares/rateLimits");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");

const authRoutes = require("./routes/authRoute");
const errorHandler = require("./middlewares/errorMiddleware");
const requestId = require("./middlewares/requestId");
const passport = require("./config/passport");

const app = express();
app.set("trust proxy", 1);

app.use(requestId);
app.use(passport.initialize());

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        fontSrc: ["'self'", "data:"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" }, // frontend lives on another origin
  })
);

// Bearer-only public API (Phase 5.4) — mounted BEFORE the app CORS whitelist
// and JSON parser so it gets its own permissive CORS + 16KB body limit.
// The whitelist below is completely untouched for every other route.
app.use("/api/v1/public", require("./routes/apiKeyRoutes").pub);

const allowedOrigins = [
  "http://localhost:3000",
  "https://quantum-chat-frontend.onrender.com",
];
if (process.env.CLIENT_URL) allowedOrigins.push(process.env.CLIENT_URL);

app.use(cors({
  origin: (origin, cb) => {
    // Allow same-origin/no-origin calls (curl, Render health checks, proxies)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS"));
  },
  credentials: true
}));
app.use(express.json({ limit: "1mb" }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
if (process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test") {
  app.use(require("morgan")("dev"));
}

// Rate limiting — shared limiters live in middlewares/rateLimits.js so
// routers can apply aiLimiter to individual endpoints too.

// Root Route for checking status
app.get("/", (req, res) => {
  res.send("API is running successfully");
});

// Health check (unauthenticated; no secrets) — Render/monitoring friendly
app.get("/health", require("./controllers/healthController").health);

// Search Route
// Global search — Smart mode embeds the query, so the AI limiter applies to
// it; Exact mode (escaped-regex) is cheap and skips it.
app.get(
    "/api/v1/search",
    require("./middlewares/authMiddleware").requireSignIn,
    (req, res, next) => (req.query.mode === "exact" ? next() : aiLimiter(req, res, next)),
    // Smart search embeds the query — counts against the daily AI cap
    (req, res, next) => (req.query.mode === "exact" ? next() : require("./utils/aiQuota").dailyAiCap(req, res, next)),
    require("./controllers/searchController").globalSearch
);

app.use("/api/v1/auth", authLimiter, authRoutes);
app.use("/api/v1/openai", aiLimiter, require("./routes/openaiRoutes"));
app.use("/api/v1/chat", aiLimiter, require("./routes/chatRoutes"));
app.use("/api/v1/files", require("./routes/fileRoutes"));
app.use("/api/v1/jobs", require("./routes/jobRoutes"));
app.use("/api/v1/studio", aiLimiter, require("./routes/studioRoutes")); // Studio Routes
app.use("/api/v1/usage", require("./routes/usageRoutes"));
app.use("/api/v1/personas", require("./routes/personaRoutes"));
app.use("/api/v1", require("./routes/memoryRoutes")); // /memories* + /me/memory (Phase 5.1)
app.use("/api/v1", require("./routes/studyRoutes")); // /study/* (Phase 5.2)
app.use("/api/v1", require("./routes/exportRoutes")); // /export/* (Phase 5.3)
app.use("/api/v1", require("./routes/apiKeyRoutes").mgmt); // /keys* (Phase 5.4)
app.use("/api/v1/demo", require("./routes/demoRoutes")); // recorded replay (Phase 6.4)

// Feature flags for the client (auth'd, no secrets)
app.get("/api/v1/features", require("./middlewares/authMiddleware").requireSignIn, (req, res) => {
  res.json({
    agent: process.env.FEATURE_AGENT !== "false",
    audio: process.env.FEATURE_AUDIO !== "false",
    multimodal: process.env.FEATURE_MULTIMODAL !== "false",
    demo: process.env.DEMO_MODE === "true",
    demoUser: !!req.user.isDemo,
  });
});

app.use(errorHandler);

module.exports = app;
