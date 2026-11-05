const express = require("express");
const { requireSignIn } = require("../middlewares/authMiddleware");
const ec = require("../controllers/exportController");

const router = express.Router();
router.use(requireSignIn);

router.get("/export/chat/:chatId", ec.chatMd);
router.get("/export/cards.csv", ec.cardsCsv);
// Memory JSON export lives on the memory routes: GET /api/v1/memories/export

module.exports = router;
