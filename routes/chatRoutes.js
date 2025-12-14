const express = require("express");
const { getUserChats, sendMessage, generateMindmap } = require("../controllers/chatController");
const { requireSignIn } = require("../middlewares/authMiddleware");

const router = express.Router();

router.use(requireSignIn); // Protect all chat routes


router.get("/history", getUserChats);
router.get("/:chatId", require("../controllers/chatController").getChatMessages);
router.delete("/:chatId", require("../controllers/chatController").deleteChat);
router.post("/message", sendMessage);
router.post("/mindmap", generateMindmap);

module.exports = router;
