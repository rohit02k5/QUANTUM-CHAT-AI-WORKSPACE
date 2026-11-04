const mongoose = require("mongoose");

// Minimal persistent store for agent/studio-generated flashcards.
// Existing shape preserved: cards are {q, a}. Phase 5 migrates to Deck/Card.
const flashcardSetSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, default: "Untitled deck" },
    sourceFile: { type: mongoose.Schema.Types.ObjectId, ref: "File", default: null },
    sourceChat: { type: mongoose.Schema.Types.ObjectId, ref: "Chat", default: null },
    cards: [
        {
            q: { type: String, required: true },
            a: { type: String, required: true },
        },
    ],
    createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("FlashcardSet", flashcardSetSchema);
