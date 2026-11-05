const express = require("express");
const dotenv = require("dotenv");
dotenv.config();
const cors = require("cors");
const bodyParser = require("body-parser");
const rateLimit = require("express-rate-limit");
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

// Rate limiting
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

// Root Route for checking status
app.get("/", (req, res) => {
  res.send("API is running successfully");
});

// Health check (unauthenticated; no secrets) — Render/monitoring friendly
app.get("/health", require("./controllers/healthController").health);

// Search Route
app.get("/api/v1/search", require("./middlewares/authMiddleware").requireSignIn, require("./controllers/searchController").globalSearch);

app.use("/api/v1/auth", authLimiter, authRoutes);
app.use("/api/v1/openai", aiLimiter, require("./routes/openaiRoutes"));
app.use("/api/v1/chat", aiLimiter, require("./routes/chatRoutes"));
app.use("/api/v1/files", require("./routes/fileRoutes"));
app.use("/api/v1/studio", aiLimiter, require("./routes/studioRoutes")); // Studio Routes
app.use("/api/v1/usage", require("./routes/usageRoutes"));
app.use("/api/v1/personas", require("./routes/personaRoutes"));

// Feature flags for the client (auth'd, no secrets)
app.get("/api/v1/features", require("./middlewares/authMiddleware").requireSignIn, (req, res) => {
  res.json({
    agent: process.env.FEATURE_AGENT !== "false",
    audio: process.env.FEATURE_AUDIO !== "false",
  });
});

app.use(errorHandler);

module.exports = app;
