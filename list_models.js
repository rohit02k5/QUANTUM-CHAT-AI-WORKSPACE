const dotenv = require("dotenv");
dotenv.config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

async function listModels() {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    try {
        // For v0.21.0+, we might need to use the model manager or just try to get a model
        // But there is no direct public listModels method on the client instance in some versions?
        // Wait, the error message said "Call ListModels".
        // It's usually available via a separate manager or HTTP.
        // Let's check if the SDK exposes it.
        // Actually, create a model and ask it? No.
        // Let's use the fetch implementation if SDK doesn't have it easily exposed.
        // BUT the error message implies I can call it.

        // In newer SDKs:
        // const genAI = new GoogleGenerativeAI(API_KEY);
        // There is no genAI.listModels().

        // We can use the REST API manually to list models to be sure.

        console.log("Fetching models using REST API...");
        const apiKey = process.env.GEMINI_API_KEY;
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const data = await response.json();

        if (data.models) {
            console.log("Available Models:");
            data.models.forEach(m => console.log(`- ${m.name} (${m.supportedGenerationMethods})`));
        } else {
            console.error("No models found or error:", data);
        }

    } catch (error) {
        console.error("Error listing models:", error);
    }
}

listModels();
