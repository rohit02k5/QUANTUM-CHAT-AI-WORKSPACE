const express = require("express");
const multer = require("multer");
const { uploadFile, getUserFiles, searchFiles, deleteFile, viewFile, streamIngestion } = require("../controllers/fileController");
const { requireSignIn } = require("../middlewares/authMiddleware");

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
]);

// Sized for the audio cap (25MB); document-specific limits enforced in controller
const AUDIO_FEATURE = process.env.FEATURE_AUDIO !== "false";
const MAX_UPLOAD_BYTES = AUDIO_FEATURE ? 26 * 1024 * 1024 : 10 * 1024 * 1024;

const upload = multer({
    storage: storage,
    limits: { fileSize: MAX_UPLOAD_BYTES },
    fileFilter: function (req, file, cb) {
        if (!AUDIO_FEATURE && file.mimetype.startsWith("audio/")) {
            return cb(new Error("Audio uploads are disabled"));
        }
        if (ALLOWED_MIMETYPES.has(file.mimetype)) return cb(null, true);
        cb(new Error(`Unsupported file type: ${file.mimetype}`));
    },
});

// Wrap multer so file-size/type rejections return a clean 400 instead of a 500
const uploadSingle = (req, res, next) => {
    upload.single("file")(req, res, (err) => {
        if (err) {
            const status = err.name === "MulterError" && err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
            return res.status(status).json({ message: err.message || "Upload rejected" });
        }
        next();
    });
};

router.post("/upload", uploadSingle, uploadFile);
router.get("/list", getUserFiles);
router.get("/search", searchFiles);
router.get("/:fileId/view", viewFile);
router.get("/:fileId/ingestion/stream", streamIngestion);
router.delete("/:fileId", deleteFile);

module.exports = router;
