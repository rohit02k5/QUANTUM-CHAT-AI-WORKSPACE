const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const dotenv = require("dotenv");
dotenv.config();

// Helper to delay execution
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class GeminiHelper {
    constructor() {
        if (!process.env.GEMINI_API_KEY) {
            console.error("Missing GEMINI_API_KEY in .env");
        }
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        // Default to user's preferred model, fallback to stable
        this.modelName = "gemini-2.5-flash";
        this.model = this.genAI.getGenerativeModel({ model: this.modelName });
    }

    /**
     * Generates content with retry mechanism for 503/429 errors.
     * @param {Array|String} prompt - The input prompt or parts array.
     * @param {Object} config - Optional generation config.
     * @param {number} retries - Number of retry attempts.
     * @returns {Promise<Object>} - The generation result.
     */
    async generateContentWithRetry(prompt, config = {}, retries = 3) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                // Handle different prompt formats (string vs array)
                const input = typeof prompt === "string" ? prompt : prompt;

                // If config is provided, pass it. Note: getGenerativeModel can take config, 
                // but generateContent takes prompt. GenerationConfig is usually set on the model or passed.
                // For simplicity, we assume generic generation here or use the model's default.
                // To support per-call config, we might need to instantite model differently or pass param.
                // However, generateContent supports a second arg in some SDK versions, but standard is single arg.
                // Let's rely on standard usage.

                const result = await this.model.generateContent(input);
                return result;

            } catch (error) {
                const isTransient = error.status === 503 || error.status === 429 || error.message.includes("Overloaded");
                if (isTransient && attempt < retries) {
                    const waitTime = attempt * 2000; // Exponential-ish backoff: 2s, 4s, 6s
                    console.log(`[GeminiHelper] Error ${error.status}. Retrying in ${waitTime}ms (Attempt ${attempt}/${retries})`);
                    await delay(waitTime);

                    // Optional: Switch model on repeated failure if it was a 404 or persistent 503
                    if (attempt === 2 && this.modelName === "gemini-2.5-flash") {
                        console.log("[GeminiHelper] Switching to fallback model gemini-1.5-flash");
                        this.model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                    }
                } else {
                    console.error("[GeminiHelper] Final Failure:", error.message);
                    throw error;
                }
            }
        }
    }

    // Helper to get text from response
    getText(result) {
        if (!result || !result.response) return "";
        return result.response.text();
    }
}

module.exports = new GeminiHelper();
