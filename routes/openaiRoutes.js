const express = require("express");
const {
  summaryController,
  chatbotController,
  analyzeContent,
  generateActionPlan
} = require("../controllers/openaiController");

const router = express.Router();
const { requireSignIn } = require("../middlewares/authMiddleware");

router.use(requireSignIn); // AI endpoints burn paid quota — always require auth

router.post("/summary", summaryController);
router.post("/chatbot", chatbotController);
router.post("/analyze", analyzeContent);
router.post("/action-plan", generateActionPlan);


module.exports = router;