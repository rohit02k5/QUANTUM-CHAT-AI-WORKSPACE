const dotenv = require("dotenv");
dotenv.config();
const { GoogleGenAI } = require("@google/genai");

async function listModels() {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    try {
        console.log("Fetching models via SDK...");
        const pager = await ai.models.list({ config: { pageSize: 200 } });
        const models = pager.page || [];
        console.log(`Available Models (${models.length}):`);
        models.forEach((m) => console.log(`- ${m.name} (${(m.supportedActions || []).join(",")})`));
    } catch (error) {
        console.error("Error listing models:", error.message);
    }
}

listModels();
