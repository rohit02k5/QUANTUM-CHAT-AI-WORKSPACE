const express = require("express");
const {
    getUserChats,
    sendMessage,
    streamMessage,
    getChatMessages,
    updateChat,
    deleteChat,
    generateMindmap,
} = require("../controllers/chatController");
const { requireSignIn } = require("../middlewares/authMiddleware");
const { dailyAiCap } = require("../utils/aiQuota");

const router = express.Router();

router.use(requireSignIn); // Protect all chat routes

router.get("/history", getUserChats);
router.get("/:chatId", getChatMessages);
router.patch("/:chatId", updateChat);
router.delete("/:chatId", deleteChat);
// Daily AI-request cap: one chat/agent request counts once
router.post("/message", dailyAiCap, sendMessage);
router.post("/mindmap", dailyAiCap, generateMindmap);
// SSE streaming chat — ":chatId" may be "new" to start a fresh conversation
router.post("/:chatId/stream", dailyAiCap, streamMessage);

module.exports = router;
