const mongoose = require("mongoose");

// Study decks (Phase 5.2). Owner-scoped; deleting a deck cascades to its
// cards and review logs via the controller (cards/logs also die with the
// user via the account-deletion cascade registry).
const deckSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    sourceFile: { type: mongoose.Schema.Types.ObjectId, ref: "File" },
    createdAt: { type: Date, default: Date.now },
});

deckSchema.index({ user: 1, name: 1 });

module.exports = mongoose.model("Deck", deckSchema);
