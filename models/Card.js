const mongoose = require("mongoose");

// Flashcards inside a Deck, with SM-2 scheduling fields. `due` drives the
// study queue; generation-created cards start due immediately.
const cardSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    deck: { type: mongoose.Schema.Types.ObjectId, ref: "Deck", required: true },
    front: { type: String, required: true, maxlength: 2000 },
    back: { type: String, required: true, maxlength: 4000 },
    // SM-2 state — services/sm2.js is the only writer of these.
    ease: { type: Number, default: 2.5, min: 1.3 },
    intervalDays: { type: Number, default: 0 },
    due: { type: Date, default: Date.now },
    reps: { type: Number, default: 0 },
    lapses: { type: Number, default: 0 },
    lastReviewedAt: { type: Date }, // idempotency guard for double-submits
    createdAt: { type: Date, default: Date.now },
});

cardSchema.index({ user: 1, due: 1 });
cardSchema.index({ deck: 1, due: 1 });

module.exports = mongoose.model("Card", cardSchema);
