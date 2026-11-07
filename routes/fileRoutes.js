const express = require("express");
const multer = require("multer");
const { uploadFile, getUserFiles, searchFiles, deleteFile, viewFile, streamIngestion, reprocessFile, getFileInfo, deepAnalysis, deepAnalysisQuota, askData } = require("../controllers/fileController");
const { requireSignIn } = require("../middlewares/authMiddleware");
const { aiLimiter } = require("../middlewares/rateLimits");
const { dailyAiCap } = require("../utils/aiQuota");

const router = express.Router();
router.use(requireSignIn);


const fs = require("fs");
const path = require("path");

// Ensure upload directory exists (multer temp staging; bytes then go to GridFS)
const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer Config — disk staging is temporary; the controller moves bytes to GridFS
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Sanitize filename for Windows compatibility
        const sanitized = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
        cb(null, Date.now() + '-' + sanitized);
    }
});

// Only allow mimetypes that utils/dataLoader.js can parse, plus audio
const ALLOWED_MIMETYPES = new Set([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/markdown",
    "text/x-markdown",
    "text/csv",
    "application/csv",
    "application/vnd.ms-excel",
    "application/json",
    // audio (validated again by magic bytes in the controller)
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/x-wav",
    "audio/ogg",
    "audio/flac",
    "audio/mp4",
    "audio/m4a",
    "audio/x-m4a",
    "audio/aac",
    // images (validated again by magic bytes in the controller)
    "image/png",
    "image/jpg",
    "image/jpeg",
    "image/webp",
]);

// Sized for the audio cap (25MB); document-specific limits enforced in controller
const audio = require("../utils/audio");
const image = require("../utils/image");
const AUDIO_FEATURE = process.env.FEATURE_AUDIO !== "false";
const DOC_MAX_BYTES = 10 * 1024 * 1024;
const MAX_UPLOAD_BYTES = AUDIO_FEATURE ? 26 * 1024 * 1024 : DOC_MAX_BYTES;

// Reject oversized uploads by TYPE as early as possible — Content-Length is
// declared before the body streams to disk, so we can refuse before staging.
// Slightly conservative (multipart overhead counts against the cap).
const perTypeCap = (mimetype) =>
    mimetype.startsWith("audio/") ? audio.AUDIO_MAX_BYTES()
        : mimetype.startsWith("image/") ? image.IMAGE_MAX_BYTES()
        : DOC_MAX_BYTES;
const tooBig = (msg) => Object.assign(new Error(msg), { code: "LIMIT_FILE_SIZE" });

const upload = multer({
    storage: storage,
    limits: { fileSize: MAX_UPLOAD_BYTES },
    fileFilter: function (req, file, cb) {
        if (!AUDIO_FEATURE && file.mimetype.startsWith("audio/")) {
            return cb(new Error("Audio uploads are disabled"));
        }
        if (!image.MULTIMODAL_FEATURE() && file.mimetype.startsWith("image/")) {
            return cb(new Error("Image uploads are disabled"));
        }
        if (!ALLOWED_MIMETYPES.has(file.mimetype)) {
            return cb(new Error(`Unsupported file type: ${file.mimetype}`));
        }
        const declared = parseInt(req.headers["content-length"] || "0", 10);
        const cap = perTypeCap(file.mimetype);
        if (declared > cap) {
            const kind = file.mimetype.startsWith("audio/") ? "Audio files"
                : file.mimetype.startsWith("image/") ? "Images" : "Documents";
            return cb(tooBig(`${kind} are limited to ${Math.round(cap / 1024 / 1024)}MB`));
        }
        cb(null, true);
    },
});

// Wrap multer so file-size/type rejections return a clean 400 instead of a 500
const uploadSingle = (req, res, next) => {
    upload.single("file")(req, res, (err) => {
        if (err) {
            const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
            return res.status(status).json({ message: err.message || "Upload rejected" });
        }
        next();
    });
};

router.post("/upload", require("../controllers/demoController").denyDemo, uploadSingle, uploadFile);
router.get("/list", getUserFiles);
router.get("/search", searchFiles);
router.get("/:fileId/view", viewFile);
router.get("/:fileId/info", getFileInfo);
router.get("/:fileId/ingestion/stream", streamIngestion);
router.post("/:fileId/reprocess", reprocessFile);
router.post("/:fileId/deep-analysis", aiLimiter, dailyAiCap, deepAnalysis);
router.get("/:fileId/deep-analysis/quota", deepAnalysisQuota);
router.post("/:fileId/ask-data", aiLimiter, dailyAiCap, askData);
router.delete("/:fileId", deleteFile);

module.exports = router;
