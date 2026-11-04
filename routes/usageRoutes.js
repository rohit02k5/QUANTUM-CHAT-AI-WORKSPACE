const express = require("express");
const { requireSignIn } = require("../middlewares/authMiddleware");
const { myUsage, adminUsage } = require("../controllers/usageController");

const router = express.Router();
router.use(requireSignIn);

router.get("/me", myUsage);
router.get("/admin", adminUsage);

module.exports = router;
