const { GoogleGenAI } = require("@google/genai");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const logger = require("./logger");
const { getRequestId, getUserId } = require("./requestContext");
dotenv.config();

// Helper to delay execution
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const EMBEDDING_DIMS = parseInt(process.env.EMBEDDING_DIMS || "768", 10);

/**
 * Records a UsageEvent for every Gemini call. Fire-and-forget: never
 * blocks or fails a request on telemetry problems.
 */
function recordUsage({ kind, model, latencyMs, ok, usageMetadata, errorCode }) {
    try {
        if (mongoose.connection.readyState !== 1) return;
        const UsageEvent = require("../models/UsageEvent");
        UsageEvent.create({
            user: getUserId() || undefined,
            kind,
            model,
            promptTokens: usageMetadata?.promptTokenCount || 0,
            outputTokens: usageMetadata?.candidatesTokenCount || 0,
            latencyMs: Math.round(latencyMs || 0),
            ok: ok !== false,
            errorCode: errorCode ? String(errorCode).slice(0, 120) : undefined,
            requestId: getRequestId(),
        }).catch(() => {});
    } catch (e) {
        /* telemetry must never break the request path */
    }
}

/** L2-normalize a vector in place-safe fashion. */
function l2Normalize(values) {
    let norm = 0;
    for (const v of values) norm += v * v;
    norm = Math.sqrt(norm);
    if (!norm || Math.abs(norm - 1) < 1e-6) return values;
    return values.map((v) => v / norm);
}

class GeminiHelper {
    constructor() {
        if (!process.env.GEMINI_API_KEY && process.env.GEMINI_MOCK !== "1") {
            logger.error("Missing GEMINI_API_KEY in .env");
        }
        this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "mock" });
        this.modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
        this.fallbackModels = (
            process.env.GEMINI_FALLBACK_MODELS || "gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.6-flash"
        ).split(",");
        this.embeddingModel = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2";
        this._mock = process.env.GEMINI_MOCK === "1" ? require("./geminiMock") : null;
    }

    /**
     * Embed text for retrieval.
     * @param {string} text
     * @param {object} opts - { task: 'document'|'query' }
     * @returns {Promise<number[]>} vector of length EMBEDDING_DIMS (L2-normalized)
     */
    async getEmbedding(text, { task = "document" } = {}) {
        const start = Date.now();
        if (this._mock) return this._mock.embed(text);
        const taskType = task === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT";
        try {
            const result = await this.ai.models.embedContent({
                model: this.embeddingModel,
                contents: text,
                config: { outputDimensionality: EMBEDDING_DIMS, taskType },
            });
            recordUsage({ kind: "embed", model: this.embeddingModel, latencyMs: Date.now() - start, ok: true });
            const values = result.embeddings[0].values;
            return l2Normalize(values);
        } catch (error) {
            recordUsage({ kind: "embed", model: this.embeddingModel, latencyMs: Date.now() - start, ok: false, errorCode: error.status || error.message });
            logger.error({ err: error.message }, "[GeminiHelper] Embedding Error");
            throw error;
        }
    }

    /**
     * Generates content with retry mechanism for 503/429 errors.
     * @param {string|Array} prompt - text or SDK contents array
     * @param {Object} config - SDK generateContent config (systemInstruction, tools, responseSchema, ...)
     * @param {number} retries
     * @param {string} kind - UsageEvent kind
     * @returns {Promise<Object>} - SDK response (use getText)
     */
    async generateContentWithRetry(prompt, config = {}, retries = 3, kind = "chat", signal = null) {
        if (this._mock) return this._mock.generate(prompt, config);
        const models = [this.modelName, ...this.fallbackModels];
        let lastError;
        for (let m = 0; m < models.length; m++) {
            const model = models[m];
            for (let attempt = 1; attempt <= retries; attempt++) {
                if (signal?.aborted) throw new Error("aborted");
                const start = Date.now();
                try {
                    const result = await this.ai.models.generateContent({
                        model,
                        contents: prompt,
                        config: { ...config, abortSignal: signal || undefined },
                    });
                    recordUsage({ kind, model, latencyMs: Date.now() - start, ok: true, usageMetadata: result.usageMetadata });
                    return result;
                } catch (error) {
                    lastError = error;
                    recordUsage({ kind, model, latencyMs: Date.now() - start, ok: false, errorCode: error.status || error.message });
                    const isTransient =
                        error.status === 503 ||
                        error.status === 429 ||
                        (error.message || "").includes("Overloaded");
                    const isModelMissing =
                        error.status === 404 || (error.message || "").includes("not found");
                    if (isModelMissing) break; // move to next model
                    if (isTransient && attempt < retries) {
                        const waitTime = attempt * 2000;
                        logger.warn({ model, attempt, status: error.status }, `[GeminiHelper] transient error, retrying in ${waitTime}ms`);
                        await delay(waitTime);
                    } else if (!isTransient) {
                        break; // non-retryable -> next model
                    }
                }
            }
        }
        logger.error({ err: lastError?.message }, "[GeminiHelper] Final Failure");
        throw lastError;
    }

    /**
     * Streaming generation. Returns an async-iterable of SDK chunks; caller
     * forwards text as it arrives. Tries each configured model in turn —
     * a model is skipped only if it fails BEFORE producing its first chunk.
     * Usage recorded on completion/failure. Pass an AbortSignal to cancel.
     */
    async generateContentStream(prompt, config = {}, kind = "chat", signal = null) {
        const models = [this.modelName, ...this.fallbackModels];
        if (this._mock) return this._mock.generateStream(prompt, config);
        const start = Date.now();
        let lastError;

        for (const model of models) {
            if (signal?.aborted) break;
            try {
                const stream = await this.ai.models.generateContentStream({
                    model,
                    contents: prompt,
                    config: { ...config, abortSignal: signal || undefined },
                });
                // Pull the first chunk eagerly: any failure before it is a
                // "failed to start" and we fall through to the next model.
                const it = stream[Symbol.asyncIterator]();
                const first = await it.next();
                return (async function* () {
                    try {
                        if (!first.done) yield first.value;
                        for await (const chunk of { [Symbol.asyncIterator]: () => it }) {
                            yield chunk;
                        }
                        recordUsage({ kind, model, latencyMs: Date.now() - start, ok: true });
                    } catch (error) {
                        recordUsage({ kind, model, latencyMs: Date.now() - start, ok: false, errorCode: error.status || error.message });
                        throw error;
                    }
                })();
            } catch (error) {
                lastError = error;
                recordUsage({ kind, model, latencyMs: Date.now() - start, ok: false, errorCode: error.status || error.message });
                logger.warn({ model, status: error.status, err: error.message }, "[GeminiHelper] stream failed to start, trying next model");
            }
        }
        logger.error({ err: lastError?.message }, "[GeminiHelper] All models failed to stream");
        throw lastError;
    }

    /**
     * Chat variant of the stream — formats history + prompt like
     * generateChatWithRetry so both paths send identical contents.
     */
    async generateChatStream(history, prompt, config = {}, signal = null) {
        const historyText = (history || [])
            .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.parts?.[0]?.text || ""}`)
            .join("\n");
        const fullPrompt = historyText
            ? `${historyText}\n\nUser: ${prompt}\nAssistant:`
            : `User: ${prompt}\nAssistant:`;
        return this.generateContentStream(fullPrompt, config, "chat", signal);
    }

    /**
     * Single-shot generation on the cheapest configured model (used for
     * background work like auto-titles). No fallback chain — cheap by design.
     */
    async generateCheapest(prompt, config = {}, kind = "chat", signal = null) {
        if (this._mock) return this._mock.generate(prompt, config);
        const model = this.fallbackModels[this.fallbackModels.length - 1] || this.modelName;
        const start = Date.now();
        try {
            const result = await this.ai.models.generateContent({
                model,
                contents: prompt,
                config: { ...config, abortSignal: signal || undefined },
            });
            recordUsage({ kind, model, latencyMs: Date.now() - start, ok: true, usageMetadata: result.usageMetadata });
            return result;
        } catch (error) {
            recordUsage({ kind, model, latencyMs: Date.now() - start, ok: false, errorCode: error.status || error.message });
            throw error;
        }
    }

    /**
     * One non-streaming agent turn: full contents array + tool config.
     * Uses the retry/fallback chain with kind "agent".
     */
    async generateAgentTurn(contents, config = {}, signal = null) {
        return this.generateContentWithRetry(contents, config, 2, "agent", signal);
    }

    /**
     * Extract function calls from a generateContent response.
     * @returns {Array<{id?:string, name:string, args:Object}>}
     */
    getFunctionCalls(result) {
        if (!result) return [];
        if (Array.isArray(result.functionCalls) && result.functionCalls.length) {
            return result.functionCalls.map((fc) => ({
                id: fc.id,
                name: fc.name,
                args: fc.args || {},
            }));
        }
        const parts = result.candidates?.[0]?.content?.parts || [];
        return parts
            .filter((p) => p.functionCall)
            .map((p) => ({ id: p.functionCall.id, name: p.functionCall.name, args: p.functionCall.args || {} }));
    }

    /** Raw model content parts (for feeding a turn back into contents). */
    getResponseParts(result) {
        return result?.candidates?.[0]?.content?.parts || [];
    }

    getUsageMetadata(result) {
        return result?.usageMetadata || null;
    }

    // Helper to get text from a generateContent response (new SDK: .text getter)
    getText(result) {
        if (!result) return "";
        if (typeof result.text === "string") return result.text;
        // legacy shape compatibility
        return result.response?.text?.() || "";
    }

    /**
     * Generate chat response with history and retry logic.
     * Sends history+prompt as formatted contents to avoid startChat() quirks.
     */
    async generateChatWithRetry(history, prompt, retries = 3, config = {}) {
        const historyText = (history || [])
            .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.parts?.[0]?.text || ""}`)
            .join("\n");
        const fullPrompt = historyText
            ? `${historyText}\n\nUser: ${prompt}\nAssistant:`
            : `User: ${prompt}\nAssistant:`;
        return this.generateContentWithRetry(fullPrompt, config, retries, "chat");
    }

    /**
     * Boot/health check: verify configured models exist on this key.
     * @returns {Promise<{chat: string[], embedding: string, missing: string[]}>}
     */
    async verifyConfiguredModels() {
        const configured = [this.modelName, ...this.fallbackModels, this.embeddingModel];
        const unique = [...new Set(configured)];
        const result = { chat: [this.modelName, ...this.fallbackModels], embedding: this.embeddingModel, missing: [] };
        if (this._mock) return result;
        try {
            const pager = await this.ai.models.list({ config: { pageSize: 200 } });
            const available = new Set((pager.page || []).map((m) => m.name.replace(/^models\//, "")));
            result.missing = unique.filter((m) => !available.has(m));
            if (result.missing.length) {
                logger.warn({ missing: result.missing }, "[GeminiHelper] configured models not available on this key");
            }
        } catch (err) {
            result.missing = unique; // couldn't verify — report all unknown
            result.listError = err.message;
        }
        return result;
    }
}

module.exports = new GeminiHelper();
module.exports.EMBEDDING_DIMS = EMBEDDING_DIMS;
