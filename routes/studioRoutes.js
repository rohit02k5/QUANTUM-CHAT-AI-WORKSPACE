const express = require("express");
const { compareDocuments, generateFlashcards, saveFlashcardsToDeck } = require("../controllers/studioController");
const { requireSignIn } = require("../middlewares/authMiddleware");

const router = express.Router();
router.use(requireSignIn);

router.post("/compare", compareDocuments);
router.post("/flashcards", generateFlashcards);
router.post("/flashcards/save", saveFlashcardsToDeck); // Phase 5.2: persist as Deck+Cards

module.exports = router;
