const { GoogleGenAI } = require("@google/genai");
const dotenv = require("dotenv");
dotenv.config();

const modelsToTest = [
    process.env.GEMINI_MODEL || "gemini-2.5-flash",
    ...(process.env.GEMINI_FALLBACK_MODELS || "gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.6-flash").split(","),
];

async function testModels() {
    console.log("--- Testing Models for Connectivity ---");
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    for (const modelName of modelsToTest) {
        try {
            process.stdout.write(`Testing ${modelName}... `);
            const result = await ai.models.generateContent({ model: modelName, contents: "Hello?" });
            const text = result.text;

            if (text) {
                console.log("SUCCESS");
                console.log(`>>> WINNER: ${modelName} is working.`);
                return; // Stop at the first working model
            }
        } catch (error) {
            console.log(`FAILED (${error.status || "Error"}: ${(error.message || "").substring(0, 80)}...)`);
        }
    }
    console.log("--- End of Test ---");
}

testModels();
