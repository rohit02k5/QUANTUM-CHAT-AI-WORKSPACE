const express = require("express");
const { requireSignIn } = require("../middlewares/authMiddleware");
const { aiLimiter } = require("../middlewares/rateLimits");
const mc = require("../controllers/memoryController");

const router = express.Router();
router.use(requireSignIn);

// /api/v1/memories — aiLimiter on write paths (they embed)
router.get("/memories", mc.list);
router.get("/memories/export", mc.exportJson);
router.post("/memories", aiLimiter, mc.create);
router.patch("/memories/:id", aiLimiter, mc.update);
router.delete("/memories/:id", mc.remove);
router.delete("/memories", mc.removeAll);

// /api/v1/me/memory — toggle + first-use notice
router.patch("/me/memory", mc.setEnabled);
router.post("/me/memory/notice", mc.noticeSeen);

module.exports = router;
