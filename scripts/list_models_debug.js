const { GoogleGenAI } = require("@google/genai");
const dotenv = require("dotenv");
const fs = require("fs");
dotenv.config();

async function listModels() {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const pager = await ai.models.list({ config: { pageSize: 200 } });
        const names = (pager.page || []).map((m) => m.name).join("\n");
        if (names) {
            fs.writeFileSync("scripts/models_output.txt", names);
            console.log("Models written to scripts/models_output.txt");
        } else {
            console.log("No models found");
        }
    } catch (error) {
        console.error("Error:", error.message);
    }
}

listModels();
