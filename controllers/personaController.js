const Persona = require("../models/Persona");
const PERSONA_PRESETS = require("../config/personas");

const MAX_PROMPT_LEN = 2000;
const MAX_PERSONAS_PER_USER = 20;

const validate = ({ name, systemPrompt }) => {
    if (name !== undefined && (typeof name !== "string" || !name.trim() || name.length > 60)) {
        return "name must be a non-empty string up to 60 chars";
    }
    if (systemPrompt !== undefined && (typeof systemPrompt !== "string" || !systemPrompt.trim() || systemPrompt.length > MAX_PROMPT_LEN)) {
        return `systemPrompt must be a non-empty string up to ${MAX_PROMPT_LEN} chars`;
    }
    return null;
};

// GET /api/v1/personas — built-in presets + the caller's custom personas
exports.listPersonas = async (req, res) => {
    try {
        const personas = await Persona.find({ user: req.user._id }).sort({ name: 1 }).lean();
        res.status(200).json({ presets: Object.values(PERSONA_PRESETS), personas });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// POST /api/v1/personas {name, systemPrompt}
exports.createPersona = async (req, res) => {
    try {
        const { name, systemPrompt } = req.body;
        const err = validate({ name, systemPrompt });
        if (err) return res.status(400).json({ message: err });
        const count = await Persona.countDocuments({ user: req.user._id });
        if (count >= MAX_PERSONAS_PER_USER) {
            return res.status(400).json({ message: `Persona limit reached (${MAX_PERSONAS_PER_USER})` });
        }
        const persona = await Persona.create({
            user: req.user._id,
            name: name.trim(),
            systemPrompt: systemPrompt.trim(),
        });
        res.status(201).json({ persona });
    } catch (err) {
        if (err.code === 11000) return res.status(409).json({ message: "A persona with that name already exists" });
        res.status(500).json({ message: "Server Error" });
    }
};

// PATCH /api/v1/personas/:id {name?, systemPrompt?}
exports.updatePersona = async (req, res) => {
    try {
        const err = validate(req.body);
        if (err) return res.status(400).json({ message: err });
        const update = {};
        if (req.body.name) update.name = req.body.name.trim();
        if (req.body.systemPrompt) update.systemPrompt = req.body.systemPrompt.trim();
        if (!Object.keys(update).length) return res.status(400).json({ message: "Nothing to update" });
        const persona = await Persona.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id },
            { $set: update },
            { new: true }
        );
        if (!persona) return res.status(404).json({ message: "Persona not found" });
        res.status(200).json({ persona });
    } catch (err) {
        if (err.code === 11000) return res.status(409).json({ message: "A persona with that name already exists" });
        res.status(500).json({ message: "Server Error" });
    }
};

// DELETE /api/v1/personas/:id — also detaches it from any chats using it
exports.deletePersona = async (req, res) => {
    try {
        const persona = await Persona.findOneAndDelete({ _id: req.params.id, user: req.user._id });
        if (!persona) return res.status(404).json({ message: "Persona not found" });
        await require("../models/Chat").updateMany(
            { user: req.user._id, personaId: persona._id },
            { $set: { personaId: null } }
        );
        res.status(200).json({ message: "Persona deleted" });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};
