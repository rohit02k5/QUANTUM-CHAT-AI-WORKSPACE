const express = require("express");
const router = express.Router();
const { requireSignIn } = require("../middlewares/authMiddleware");
const demo = require("../controllers/demoController");

// Recorded-replay + scenario list — authenticated, never a live model call.
router.use(requireSignIn);
router.get("/scenarios", demo.scenarios);
router.get("/replay/:scenario", demo.replay);

module.exports = router;
