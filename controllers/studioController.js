const File = require("../models/File");
const geminiHelper = require("../utils/geminiHelper");
const dotenv = require("dotenv");
dotenv.config();

// Compare Documents
exports.compareDocuments = async (req, res) => {
    try {
        const { fileIds } = req.body; // Expecting array of file IDs
        if (!Array.isArray(fileIds) || fileIds.length < 2) return res.status(400).json({ message: "Provide at least 2 file IDs" });

        const files = await File.find({ _id: { $in: fileIds }, user: req.user._id });
        if (files.length !== fileIds.length) return res.status(404).json({ message: "Some files not found" });

        const texts = files.map((f, i) => `Document ${i + 1} (${f.originalName}):\n${f.content}`).join("\n\n");

        const prompt = `Compare the following documents. Provide:
        1. List of 3-5 key Similarities.
        2. List of 3-5 key Differences.
        3. A short Synthesis/Insight combining them.
        
        Input Data:
        ${texts}
        
        Return JSON format: { "similarities": [], "differences": [], "keyInsights": "" }`;

        const result = await geminiHelper.generateContentWithRetry(prompt);
        let responseText = geminiHelper.getText(result);

        // Clean JSON formatting
        responseText = responseText.replace(/```json/g, "").replace(/```/g, "").trim();

        let jsonResponse;
        try {
            jsonResponse = JSON.parse(responseText);
        } catch (e) {
            console.error("JSON Parse Error:", e);
            // Fallback object so frontend doesn't crash
            jsonResponse = {
                similarities: ["Could not parse AI response", "Check server logs for raw output"],
                differences: [],
                keyInsights: "AI returned an invalid format. It might be refusing the content."
            };
        }

        res.status(200).json(jsonResponse);
    } catch (err) {
        console.error("Comparison Error:", err);
        res.status(500).json({ message: "Comparison Failed" });
    }
};

// Generate Flashcards
exports.generateFlashcards = async (req, res) => {
    try {
        const { fileId, topic } = req.body;
        const file = await File.findOne({ _id: fileId, user: req.user._id });
        if (!file) return res.status(404).json({ message: "File not found" });

        const prompt = `Generate 5 study flashcards based on the following text. 
        Focus on key concepts${topic ? ` related to '${topic}'` : ""}.
        
        Text:
        ${file.content ? file.content.substring(0, 10000) : "No content available"}
        
        Return STRICT JSON format: [ { "q": "Question?", "a": "Answer" }, ... ]`;

        const result = await geminiHelper.generateContentWithRetry(prompt);
        let responseText = geminiHelper.getText(result);

        responseText = responseText.replace(/```json/g, "").replace(/```/g, "").trim();

        let flashcards;
        try {
            flashcards = JSON.parse(responseText);
        } catch (e) {
            console.error("JSON Parse Error:", e);
            flashcards = [{ q: "Error parsing AI response", a: "Please try again." }];
        }

        res.status(200).json({ flashcards });
    } catch (err) {
        console.error("Flashcard Error:", err);
        res.status(500).json({ message: "Flashcard Generation Failed" });
    }
};

// Phase 5.2 — persist generated flashcards as a FlashcardSet (legacy) AND a
// study Deck + Cards (due immediately, SM-2 reviewable). "Add to deck" in the
// Studio UI calls this with the generated cards.
exports.saveFlashcardsToDeck = async (req, res) => {
    try {
        const { fileId, name, cards } = req.body || {};
        const valid = (Array.isArray(cards) ? cards : [])
            .filter((c) => c && String(c.q || "").trim() && String(c.a || "").trim())
            .slice(0, 50)
            .map((c) => ({ q: String(c.q).slice(0, 1000), a: String(c.a).slice(0, 2000) }));
        if (!valid.length) return res.status(400).json({ message: "cards[] with {q, a} required" });

        let file = null;
        if (fileId) {
            file = await File.findOne({ _id: fileId, user: req.user._id }).select("_id originalName");
            if (!file) return res.status(404).json({ message: "File not found" });
        }
        const deckName = String(name || "").trim().slice(0, 120)
            || (file ? `Flashcards — ${file.originalName}` : "Flashcards");

        const FlashcardSet = require("../models/FlashcardSet");
        const Deck = require("../models/Deck");
        const Card = require("../models/Card");
        const { _internal } = require("./studyController");

        const [set, deck] = await Promise.all([
            FlashcardSet.create({
                user: req.user._id, name: deckName,
                sourceFile: file?._id || null, cards: valid,
            }),
            Deck.create({ user: req.user._id, name: deckName, sourceFile: file?._id }),
        ]);
        const created = [];
        for (const c of valid) {
            try {
                created.push(await _internal.insertCard(req.user._id, deck._id, c.q, c.a));
            } catch (e) {
                if (e.code === "STUDY_CARD_CAP") break;
                throw e;
            }
        }
        res.status(201).json({ flashcardSetId: set._id, deckId: deck._id, created: created.length, name: deckName });
    } catch (err) {
        console.error("Save-to-deck error:", err);
        res.status(500).json({ message: "Could not save deck" });
    }
};
