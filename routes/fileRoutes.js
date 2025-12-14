const express = require("express");
const multer = require("multer");
const { uploadFile, getUserFiles, searchFiles } = require("../controllers/fileController");
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
const upload = multer({ storage: storage });

router.post("/upload", upload.single("file"), uploadFile);
router.get("/list", getUserFiles);
router.get("/search", searchFiles);

module.exports = router;
