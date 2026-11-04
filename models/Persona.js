const mongoose = require("mongoose");

const personaSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    systemPrompt: { type: String, required: true, maxlength: 2000 },
    createdAt: { type: Date, default: Date.now },
});

personaSchema.index({ user: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("Persona", personaSchema);
