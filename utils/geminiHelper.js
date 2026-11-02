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
        this.modelName = "gemini-pro-latest";
        this.model = this.genAI.getGenerativeModel({ model: this.modelName });
    }

    async getEmbedding(text) {
        try {
            const embeddingModel = this.genAI.getGenerativeModel({ model: "models/gemini-embedding-2" });
            const result = await embeddingModel.embedContent(text);
            return result.embedding.values;
        } catch (error) {
            console.error("[GeminiHelper] Embedding Error:", error.message);
            throw error;
        }
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
                    const waitTime = attempt * 2000;
                    console.log(`[GeminiHelper] Error ${error.status}. Retrying in ${waitTime}ms (Attempt ${attempt}/${retries})`);
                    await delay(waitTime);

                    // Switch to fallback model on persistent 503
                    if (attempt === 2) {
                        const fallbackModels = ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash"];
                        this.modelName = fallbackModels[0];
                        console.log(`[GeminiHelper] Switching to fallback model ${this.modelName}`);
                        this.model = this.genAI.getGenerativeModel({ model: this.modelName });
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

    /**
     * Generate chat response with history and retry logic.
     * Uses generateContentWithRetry with formatted history to avoid startChat() hanging issues.
     * @param {Array} history - Array of {role: "user"|"model", parts: [{text: string}]}
     * @param {string} prompt - Current user message
     * @param {number} retries - Number of retry attempts
     */
    async generateChatWithRetry(history, prompt, retries = 3) {
        // Format history + prompt into a single text prompt
        const historyText = history
            .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.parts?.[0]?.text || ""}`)
            .join("\n");
        const fullPrompt = `${historyText}\n\nUser: ${prompt}\nAssistant:`;

        return this.generateContentWithRetry(fullPrompt, {}, retries);
    }
}

module.exports = new GeminiHelper();
