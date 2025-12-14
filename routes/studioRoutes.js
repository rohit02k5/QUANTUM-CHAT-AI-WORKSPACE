const express = require("express");
const { compareDocuments, generateFlashcards } = require("../controllers/studioController");
const { requireSignIn } = require("../middlewares/authMiddleware");

const router = express.Router();
router.use(requireSignIn);

router.post("/compare", compareDocuments);
router.post("/flashcards", generateFlashcards);

module.exports = router;
