const express = require("express");
const {
  summaryController,
  chatbotController,
} = require("../controllers/openaiController");

const router = express.Router();

router.post("/summary", summaryController);
router.post("/chatbot", chatbotController);


module.exports = router;