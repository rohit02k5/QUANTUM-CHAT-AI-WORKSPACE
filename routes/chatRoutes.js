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

const router = express.Router();

router.use(requireSignIn); // Protect all chat routes

router.get("/history", getUserChats);
router.get("/:chatId", getChatMessages);
router.patch("/:chatId", updateChat);
router.delete("/:chatId", deleteChat);
router.post("/message", sendMessage);
router.post("/mindmap", generateMindmap);
// SSE streaming chat — ":chatId" may be "new" to start a fresh conversation
router.post("/:chatId/stream", streamMessage);

module.exports = router;
