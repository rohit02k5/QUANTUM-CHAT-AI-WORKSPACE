const express = require("express");
const { getJob, retryJob } = require("../controllers/fileController");
const { requireSignIn } = require("../middlewares/authMiddleware");

const router = express.Router();
router.use(requireSignIn);

router.get("/:id", getJob);
router.post("/:id/retry", retryJob);

module.exports = router;
