const express = require("express");
const multer = require("multer");
const { uploadFile, getUserFiles, searchFiles, deleteFile } = require("../controllers/fileController");
const { requireSignIn } = require("../middlewares/authMiddleware");

const router = express.Router();
router.use(requireSignIn);


const fs = require("fs");
const path = require("path");

// Ensure upload directory exists
const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer Config
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

// Only allow mimetypes that utils/dataLoader.js can parse
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
]);

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter: function (req, file, cb) {
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
router.delete("/:fileId", deleteFile);

module.exports = router;
