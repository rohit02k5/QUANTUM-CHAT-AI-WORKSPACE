const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require("dotenv");
const fs = require("fs");
dotenv.config();

async function listModels() {
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        // Note: getGenerativeModel doesn't list models, explicitly using the API would be better
        // But the SDK doesn't expose listModels helper directly on the main class in all versions.
        // Let's use fetch directly to be sure.

        const apiKey = process.env.GEMINI_API_KEY;
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

        const response = await fetch(url);
        const data = await response.json();

        if (data.models) {
            const names = data.models.map(m => m.name).join("\n");
            fs.writeFileSync("models_output.txt", names);
            console.log("Models written to models_output.txt");
        } else {
            console.log("No models found or error:", JSON.stringify(data));
        }

    } catch (error) {
        console.error("Error:", error);
    }
}

listModels();
