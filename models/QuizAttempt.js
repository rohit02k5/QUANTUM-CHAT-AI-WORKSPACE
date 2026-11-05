const mongoose = require("mongoose");

// A generated quiz AND its grading snapshot. `questions` stores the full
// MCQ set (with correct answers) at generation time so submission grading
// is purely server-side — the client can never supply the score.
const questionSchema = new mongoose.Schema({
    q: { type: String, required: true },
    options: [{ type: String, required: true }],
    correctIndex: { type: Number, required: true, min: 0 },
    explanation: { type: String, default: "" },
    chosenIndex: { type: Number, default: null }, // filled at submit
}, { _id: false });

const quizAttemptSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    deck: { type: mongoose.Schema.Types.ObjectId, ref: "Deck" },
    sourceFile: { type: mongoose.Schema.Types.ObjectId, ref: "File" },
    questions: [questionSchema],
    score: { type: Number, default: null }, // null until submitted
    total: { type: Number, required: true },
    submittedAt: { type: Date },
    createdAt: { type: Date, default: Date.now },
});

quizAttemptSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("QuizAttempt", quizAttemptSchema);
