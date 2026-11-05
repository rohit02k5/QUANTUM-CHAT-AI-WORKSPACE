const express = require("express");
const { requireSignIn } = require("../middlewares/authMiddleware");
const { aiLimiter } = require("../middlewares/rateLimits");
const { dailyAiCap } = require("../utils/aiQuota");
const sc = require("../controllers/studyController");

const router = express.Router();
router.use(requireSignIn);

// Decks
router.get("/study/decks", sc.listDecks);
router.post("/study/decks", sc.createDeck);
router.patch("/study/decks/:id", sc.updateDeck);
router.delete("/study/decks/:id", sc.deleteDeck);

// Cards
router.get("/study/decks/:id/cards", sc.listCards);
router.post("/study/decks/:id/cards", sc.addCards);
router.delete("/study/cards/:id", sc.deleteCard);

// Review + stats
router.get("/study/due", sc.dueCards);
router.post("/study/review", sc.review);
router.get("/study/stats", sc.stats);

// Quiz — generation consumes a daily-cap unit (checked inside too for admins)
router.post("/study/quiz", aiLimiter, dailyAiCap, sc.generateQuiz);
router.post("/study/quiz/:id/submit", sc.submitQuiz);
router.get("/study/quiz/:id", sc.getQuiz);

module.exports = router;
