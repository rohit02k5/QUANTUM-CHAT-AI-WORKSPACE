const File = require("../models/File");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require("dotenv");
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// Compare Documents
exports.compareDocuments = async (req, res) => {
    try {
        const { fileIds } = req.body; // Expecting array of file IDs
        if (!fileIds || fileIds.length < 2) return res.status(400).json({ message: "Provide at least 2 file IDs" });

        const files = await File.find({ _id: { $in: fileIds } });
        if (files.length !== fileIds.length) return res.status(404).json({ message: "Some files not found" });

        const texts = files.map((f, i) => `Document ${i + 1} (${f.originalName}):\n${f.content}`).join("\n\n");

        const prompt = `Compare the following documents. Provide:
        1. List of 3-5 key Similarities.
        2. List of 3-5 key Differences.
        3. A short Synthesis/Insight combining them.
        
        Input Data:
        ${texts}
        
        Return JSON format: { "similarities": [], "differences": [], "keyInsights": "" }`;

        const result = await model.generateContent(prompt);
        let responseText = result.response.text();

        console.log("[DEBUG] Raw Gemini Response (Compare):", responseText);

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
        const file = await File.findById(fileId);
        if (!file) return res.status(404).json({ message: "File not found" });

        const prompt = `Generate 5 study flashcards based on the following text. 
        Focus on key concepts${topic ? ` related to '${topic}'` : ""}.
        
        Text:
        ${file.content ? file.content.substring(0, 10000) : "No content available"}
        
        Return STRICT JSON format: [ { "q": "Question?", "a": "Answer" }, ... ]`;

        const result = await model.generateContent(prompt);
        let responseText = result.response.text();

        console.log("[DEBUG] Raw Gemini Response (Flashcards):", responseText);

        responseText = responseText.replace(/```json/g, "").replace(/```/g, "").trim();

        let flashcards;
        try {
            flashcards = JSON.parse(responseText);
        } catch (e) {
            console.error("JSON Parse Error:", e);
            flashcards = [{ q: "Error parsing AI response", a: "Please try again." }];
        }

        res.status(200).json({ flashcards });

        res.status(200).json({ flashcards });
    } catch (err) {
        console.error("Flashcard Error:", err);
        res.status(500).json({ message: "Flashcard Generation Failed" });
    }
};
