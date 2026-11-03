const express = require("express");
const dotenv = require("dotenv");
dotenv.config();
const cors = require("cors");
const bodyParser = require("body-parser");
const colors = require("colors");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const connectDB = require("./config/db");
const mongoose = require("mongoose");
const authRoutes = require('./routes/authRoute');

// Validate critical env vars
if (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET || !process.env.JWT_ACCESS_EXPIREIN || !process.env.JWT_REFRESH_EXPIREIN) {
  console.error("FATAL ERROR: One of the JWT secrets or expiration variables is missing.".red.bold);
  console.error("Required: JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, JWT_ACCESS_EXPIREIN, JWT_REFRESH_EXPIREIN");
  process.exit(1);
}
if (!process.env.MONGO_URI) {
  console.error("FATAL ERROR: MONGO_URI is missing.".red.bold);
  process.exit(1);
}

const errorHandler = require("./middlewares/errorMiddleware");

const helmet = require('helmet');
const passport = require("./config/passport");
const app = express();
app.set("trust proxy", 1);
app.use(passport.initialize());
connectDB();

// Once DB is up: ensure the Atlas vector-search index exists (best-effort) and
// sweep stale temp uploads. Failures only downgrade RAG to the local fallback.
mongoose.connection.once("open", async () => {
    const { VECTOR_INDEX } = require("./utils/retriever");
    try {
        await mongoose.connection.collection("chunks").createSearchIndex({
            name: VECTOR_INDEX,
            type: "vectorSearch",
            definition: {
                fields: [
                    { type: "vector", path: "embedding", numDimensions: 3072, similarity: "cosine" },
                    { type: "filter", path: "user" },
                    { type: "filter", path: "file" },
                ],
            },
        });
        console.log(`[RAG] Vector search index '${VECTOR_INDEX}' ensured`);
    } catch (err) {
        console.warn(`[RAG] Could not ensure vector index '${VECTOR_INDEX}' (may already exist): ${err.message}`);
    }
    require("./controllers/fileController").cleanupTempFiles();
});

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
app.use(require("cookie-parser")());
if (process.env.NODE_ENV !== "production") {
  app.use(morgan("dev"));
}

// Rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many attempts, please try again later" },
});
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "AI rate limit exceeded, please slow down" },
});

// Root Route for checking status
app.get("/", (req, res) => {
  res.send("API is running successfully");
});

// Search Route
app.get("/api/v1/search", require("./middlewares/authMiddleware").requireSignIn, require("./controllers/searchController").globalSearch);

const PORT = process.env.PORT || 8080;
app.use("/api/v1/auth", authLimiter, authRoutes);
app.use("/api/v1/openai", aiLimiter, require("./routes/openaiRoutes"));
app.use("/api/v1/chat", aiLimiter, require("./routes/chatRoutes"));
app.use("/api/v1/files", require("./routes/fileRoutes"));
app.use("/api/v1/studio", aiLimiter, require("./routes/studioRoutes")); // Studio Routes
app.use(errorHandler);
app.listen(PORT, () => {
  console.log(`Server Running in ${process.env.DEV_MODE} on ${PORT}`.bgCyan.white);
});
