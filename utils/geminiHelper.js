const { GoogleGenAI } = require("@google/genai");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
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

/**
 * Classify a Gemini/API error so callers can behave correctly:
 *   - "daily-quota"   — the project's per-DAY generate quota is out (429 whose
 *                       quotaId/message mentions per-day). Retry within the
 *                       same hour is pointless: surface a friendly error or
 *                       requeue work with a delay. Stable code AI_QUOTA_EXHAUSTED.
 *   - "rate-limit"    — per-minute rate limit (429 without daily markers).
 *                       Backoff + retry is appropriate. Code AI_RATE_LIMITED.
 *   - "server"        — 5xx / Overloaded, transient. Code AI_UNAVAILABLE.
 *   - "model-missing" — 404. Code AI_MODEL_MISSING.
 *   - "other"         — anything else. Code AI_ERROR.
 * retryAfterMs is parsed from RetryInfo details or "Please retry in Xh Ym Zs"
 * when the API provides it.
 */
function classifyError(error) {
    const msg = String(error?.message || error || "");
    const status = error?.status ?? error?.error?.code;
    let retryAfterMs;
    const details = error?.error?.details || error?.details || [];
    const retryInfo = Array.isArray(details)
        ? details.find((d) => /RetryInfo/i.test(d?.["@type"] || ""))
        : null;
    const rd = retryInfo?.retryDelay || "";
    const rdMatch = String(rd).match(/([\d.]+)\s*s/);
    if (rdMatch) retryAfterMs = Math.round(parseFloat(rdMatch[1]) * 1000);
    const msgRetry = msg.match(/retry in\s+(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:([\d.]+)\s*s)?/i);
    if (retryAfterMs == null && msgRetry && (msgRetry[1] || msgRetry[2] || msgRetry[3])) {
        retryAfterMs = Math.round(
            ((+msgRetry[1] || 0) * 3600 + (+msgRetry[2] || 0) * 60 + (+msgRetry[3] || 0)) * 1000
        );
    }
    const isQuota = status === 429 || /RESOURCE_EXHAUSTED|quota exceeded/i.test(msg);
    if (isQuota) {
        const daily = /per.?day|PerDay|daily|GenerateRequestsPerDay/i.test(msg);
        return {
            kind: daily ? "daily-quota" : "rate-limit",
            code: daily ? "AI_QUOTA_EXHAUSTED" : "AI_RATE_LIMITED",
            retryAfterMs,
            status,
        };
    }
    if ((status >= 500 && status < 600) || /Overloaded/i.test(msg)) {
        return { kind: "server", code: "AI_UNAVAILABLE", retryAfterMs, status };
    }
    if (status === 404 || /not found/i.test(msg)) {
        return { kind: "model-missing", code: "AI_MODEL_MISSING", retryAfterMs, status };
    }
    return { kind: "other", code: "AI_ERROR", retryAfterMs, status };
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
        // Cheap-model lane (Phase 5.0d): titles, summaries, rewrites, memory
        // extraction, rerank — everything that isn't the answer itself.
        // GEMINI_CHEAP_MODEL overrides; default is the configured lite/last
        // fallback. When the cheap model is exhausted the call falls through
        // the normal chain instead of dying.
        this.cheapModelName = process.env.GEMINI_CHEAP_MODEL
            || this.fallbackModels.find((m) => m.includes("lite"))
            || this.fallbackModels[this.fallbackModels.length - 1]
            || this.modelName;
        // Audio transcription model — verified at boot; falls back to modelName
        this.transcribeModelName = process.env.GEMINI_TRANSCRIBE_MODEL || this.modelName;
        this.transcribeModelFallback = false;
        this._mock = process.env.GEMINI_MOCK === "1" ? require("./geminiMock") : null;
        // API-call counters for cost reporting (evals). Cache hits skip the
        // counter — a rerun of unchanged fixtures is free.
        this.calls = { embed: 0, generate: 0 };
        this.calls.embedCached = 0;
    }

    /**
     * On-disk embedding cache — opt-in via EMBED_CACHE_DIR (evals only; prod
     * code paths leave it unset). Keyed by sha256(text + model + dims + taskType)
     * so a model/dims change never serves stale vectors.
     */
    _embedCache() {
        const dir = process.env.EMBED_CACHE_DIR;
        if (!dir) return null;
        return {
            read(text, taskType) {
                const key = crypto
                    .createHash("sha256")
                    .update(`${text}|${this._model}|${this._dims}|${taskType}`)
                    .digest("hex");
                const fp = path.join(dir, `${key}.json`);
                try { return JSON.parse(fs.readFileSync(fp, "utf8")); } catch { return null; }
            },
            write(text, taskType, values) {
                const key = crypto
                    .createHash("sha256")
                    .update(`${text}|${this._model}|${this._dims}|${taskType}`)
                    .digest("hex");
                try {
                    fs.mkdirSync(dir, { recursive: true });
                    fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify(values));
                } catch { /* cache is best-effort */ }
            },
            _model: this.embeddingModel,
            _dims: EMBEDDING_DIMS,
        };
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
        const cache = this._embedCache();
        if (cache) {
            const hit = cache.read(text, taskType);
            if (hit) { this.calls.embedCached++; return hit; }
        }
        try {
            this.calls.embed++;
            const result = await this.ai.models.embedContent({
                model: this.embeddingModel,
                contents: text,
                config: { outputDimensionality: EMBEDDING_DIMS, taskType },
            });
            recordUsage({ kind: "embed", model: this.embeddingModel, latencyMs: Date.now() - start, ok: true });
            const values = result.embeddings[0].values;
            const vec = l2Normalize(values);
            if (cache) cache.write(text, taskType, vec);
            return vec;
        } catch (error) {
            recordUsage({ kind: "embed", model: this.embeddingModel, latencyMs: Date.now() - start, ok: false, errorCode: classifyError(error).code });
            logger.error({ err: error.message }, "[GeminiHelper] Embedding Error");
            throw error;
        }
    }

    /**
     * Batch embed — ONE embedContent call for several texts (memory dedupe
     * inserts, quiz paths). Per-text cache: cached entries don't consume an
     * API call. Returns an array aligned with `texts`; failed slots are null.
     */
    async getEmbeddings(texts, { task = "document" } = {}) {
        if (!Array.isArray(texts)) return [];
        if (this._mock) return Promise.all(texts.map((t) => this._mock.embed(t)));
        const taskType = task === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT";
        const cache = this._embedCache();
        const out = new Array(texts.length).fill(null);
        const toFetch = [];
        texts.forEach((t, i) => {
            const hit = cache?.read(t, taskType);
            if (hit) { this.calls.embedCached++; out[i] = hit; }
            else toFetch.push({ i, t });
        });
        if (!toFetch.length) return out;
        const start = Date.now();
        try {
            this.calls.embed++;
            const result = await this.ai.models.embedContent({
                model: this.embeddingModel,
                contents: toFetch.map((x) => x.t),
                config: { outputDimensionality: EMBEDDING_DIMS, taskType },
            });
            const embs = result.embeddings || [];
            toFetch.forEach(({ i, t }, j) => {
                const vec = embs[j]?.values ? l2Normalize(embs[j].values) : null;
                out[i] = vec;
                if (vec && cache) cache.write(t, taskType, vec);
            });
            recordUsage({ kind: "embed", model: this.embeddingModel, latencyMs: Date.now() - start, ok: true });
            return out;
        } catch (error) {
            recordUsage({ kind: "embed", model: this.embeddingModel, latencyMs: Date.now() - start, ok: false, errorCode: classifyError(error).code });
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
                    this.calls.generate++;
                    const result = await this.ai.models.generateContent({
                        model,
                        contents: prompt,
                        config: { ...config, abortSignal: signal || undefined },
                    });
                    recordUsage({ kind, model, latencyMs: Date.now() - start, ok: true, usageMetadata: result.usageMetadata });
                    return result;
                } catch (error) {
                    lastError = error;
                    const cls = classifyError(error);
                    recordUsage({ kind, model, latencyMs: Date.now() - start, ok: false, errorCode: cls.code });
                    // Daily quota exhausted on this model — retrying it is
                    // pointless; move straight to the next fallback model.
                    if (cls.kind === "daily-quota") {
                        logger.warn({ model }, "[GeminiHelper] daily quota exhausted on model, trying next");
                        break;
                    }
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
                this.calls.generate++;
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
                        recordUsage({ kind, model, latencyMs: Date.now() - start, ok: false, errorCode: classifyError(error).code });
                        throw error;
                    }
                })();
            } catch (error) {
                lastError = error;
                recordUsage({ kind, model, latencyMs: Date.now() - start, ok: false, errorCode: classifyError(error).code });
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
     * Single-shot generation on the cheap lane (GEMINI_CHEAP_MODEL, default
     * the configured lite model) used for background work — titles, chat
     * summaries, query rewrites, memory extraction, rerank. One attempt per
     * model, cheap first then the rest of the chain (per-model free-tier
     * quotas are separate, so a dead cheap model must not kill background
     * tasks). Caller handles a final failure — never throws early on
     * transient/daily-quota errors while a fallback remains.
     */
    async generateCheapest(prompt, config = {}, kind = "chat", signal = null) {
        if (this._mock) return this._mock.generate(prompt, config);
        const models = [...new Set([this.cheapModelName, this.modelName, ...this.fallbackModels])];
        let lastError;
        for (const model of models) {
            if (signal?.aborted) throw new Error("aborted");
            const start = Date.now();
            try {
                this.calls.generate++;
                const result = await this.ai.models.generateContent({
                    model,
                    contents: prompt,
                    config: { ...config, abortSignal: signal || undefined },
                });
                recordUsage({ kind, model, latencyMs: Date.now() - start, ok: true, usageMetadata: result.usageMetadata });
                return result;
            } catch (error) {
                lastError = error;
                recordUsage({ kind, model, latencyMs: Date.now() - start, ok: false, errorCode: classifyError(error).code });
                logger.warn({ model, status: error.status }, "[GeminiHelper] cheap-lane model failed, trying next");
            }
        }
        throw lastError;
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
        const requested = process.env.GEMINI_TRANSCRIBE_MODEL;
        const configured = [this.modelName, ...this.fallbackModels, this.embeddingModel];
        const unique = [...new Set(configured, requested).values()].filter(Boolean);
        const result = { chat: [this.modelName, ...this.fallbackModels], embedding: this.embeddingModel, transcribe: this.transcribeModelName, cheap: this.cheapModelName, missing: [] };
        if (this._mock) return result;
        try {
            const pager = await this.ai.models.list({ config: { pageSize: 200 } });
            const available = new Set((pager.page || []).map((m) => m.name.replace(/^models\//, "")));
            if (!available.has(this.cheapModelName)) {
                logger.warn({ requested: this.cheapModelName, fallback: this.modelName }, "[GeminiHelper] GEMINI_CHEAP_MODEL unavailable — cheap lane falls back to the chat model");
                result.cheap = this.modelName;
            }
            result.missing = unique.filter((m) => !available.has(m));
            if (result.missing.length) {
                logger.warn({ missing: result.missing }, "[GeminiHelper] configured models not available on this key");
            }
            // Transcribe model missing → fall back to the primary chat model
            if (requested && !available.has(requested)) {
                this.transcribeModelName = this.modelName;
                this.transcribeModelFallback = true;
                result.transcribe = this.transcribeModelName;
                logger.warn({ requested, fallback: this.modelName }, "[GeminiHelper] GEMINI_TRANSCRIBE_MODEL unavailable — using primary chat model for audio");
            }
        } catch (err) {
            result.missing = unique; // couldn't verify — report all unknown
            result.listError = err.message;
        }
        return result;
    }

    // ------------------------------------------------------------------
    // Audio / media (Phase 3A)
    // ------------------------------------------------------------------

    /**
     * Upload media to the Gemini Files API (large audio). Caller MUST pass
     * the returned name to deleteMedia() in a finally block.
     */
    async uploadMedia(buffer, mime, displayName = "quantum-audio") {
        if (this._mock) return this._mock.__uploadMedia(buffer, mime, displayName);
        const blob = new Blob([buffer], { type: mime });
        const file = await this.ai.files.upload({ file: blob, config: { mimeType: mime, displayName } });
        return { name: file.name, uri: file.uri, mimeType: file.mimeType || mime };
    }

    async deleteMedia(name) {
        if (!name) return;
        if (this._mock) { this._mock.__deleteMedia(name); return; }
        try {
            await this.ai.files.delete({ name });
        } catch (e) {
            logger.warn({ name, err: e.message }, "[GeminiHelper] media delete failed");
        }
    }

    /**
     * Transcribe audio → [{startSec,endSec,speaker,text}].
     * Small buffers go inline; larger ones use the Files API, always deleted
     * in finally. `window` {startSec,endSec} transcribes only that range for
     * long-audio segmentation (timestamps stay absolute).
     */
    async transcribeAudio(buffer, { mime, window, signal = null } = {}) {
        const windowClause = window
            ? ` Transcribe ONLY the speech between ${window.startSec} seconds and ${window.endSec} seconds. Timestamps must be absolute (relative to the start of the audio).`
            : "";
        const prompt = `Transcribe this audio. Return a JSON array of segments, each {"startSec": number, "endSec": number, "speaker": string, "text": string}. Use labels like "Speaker 1"/"Speaker 2" when voices are distinguishable, "" otherwise. Segment on natural pauses. Output JSON only.${windowClause}`;
        const schema = {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    startSec: { type: "NUMBER" },
                    endSec: { type: "NUMBER" },
                    speaker: { type: "STRING" },
                    text: { type: "STRING" },
                },
                required: ["startSec", "endSec", "text"],
            },
        };

        const inlineMax = parseFloat(process.env.AUDIO_INLINE_MAX_MB || "10") * 1024 * 1024;
        let uploadedName = null;
        let mediaPart;
        try {
            if (buffer.length <= inlineMax) {
                mediaPart = { inlineData: { mimeType: mime, data: buffer.toString("base64") } };
            } else {
                const up = await this.uploadMedia(buffer, mime);
                uploadedName = up.name;
                mediaPart = { fileData: { fileUri: up.uri, mimeType: up.mimeType } };
            }
            const contents = [{ role: "user", parts: [mediaPart, { text: prompt }] }];
            const config = { responseMimeType: "application/json", responseSchema: schema };

            let result;
            if (this._mock) {
                const start = Date.now();
                result = await this._mock.generate(contents, config);
                recordUsage({ kind: "transcribe", model: this.transcribeModelName, latencyMs: Date.now() - start, ok: true, usageMetadata: result.usageMetadata });
            } else if (this.transcribeModelName !== this.modelName) {
                // Dedicated transcribe model first, normal chain as fallback
                const start = Date.now();
                try {
                    result = await this.ai.models.generateContent({
                        model: this.transcribeModelName,
                        contents,
                        config: { ...config, abortSignal: signal || undefined },
                    });
                    recordUsage({ kind: "transcribe", model: this.transcribeModelName, latencyMs: Date.now() - start, ok: true, usageMetadata: result.usageMetadata });
                } catch (e) {
                    recordUsage({ kind: "transcribe", model: this.transcribeModelName, latencyMs: Date.now() - start, ok: false, errorCode: classifyError(e).code });
                    logger.warn({ model: this.transcribeModelName, err: e.message }, "[GeminiHelper] transcribe model failed — falling back");
                    result = await this.generateContentWithRetry(contents, config, 2, "transcribe", signal);
                }
            } else {
                result = await this.generateContentWithRetry(contents, config, 2, "transcribe", signal);
            }

            const raw = this.getText(result);
            let segments = [];
            try { segments = JSON.parse(raw); }
            catch { segments = JSON.parse((raw.match(/\[[\s\S]*\]/) || ["[]"])[0]); }
            if (!Array.isArray(segments)) segments = [];
            return { segments, usage: this.getUsageMetadata(result), model: this.transcribeModelName };
        } finally {
            if (uploadedName) await this.deleteMedia(uploadedName);
        }
    }

    // ------------------------------------------------------------------
    // Vision (Phase 3B)
    // ------------------------------------------------------------------

    /**
     * Describe an image → {caption, ocrText, dataInsights?, tags[]}.
     * Images are ≤ IMAGE_MAX_MB (8) so they always fit inline — no Files API.
     * The caller decides retryability; uses the normal fallback chain.
     */
    async describeImage(buffer, { mime, signal = null } = {}) {
        const prompt = "Analyze this image for a knowledge base. Return JSON only:\n" +
            '{"caption": string (one sentence, objective), "ocrText": string (verbatim text visible in the image, "" if none), "dataInsights": string (for charts/diagrams: the trend, axes, and key values — "" if not applicable), "tags": string[] (≤6 search keywords)}';
        const schema = {
            type: "OBJECT",
            properties: {
                caption: { type: "STRING" },
                ocrText: { type: "STRING" },
                dataInsights: { type: "STRING" },
                tags: { type: "ARRAY", items: { type: "STRING" } },
            },
            required: ["caption", "ocrText", "tags"],
        };
        const contents = [{
            role: "user",
            parts: [{ inlineData: { mimeType: mime, data: buffer.toString("base64") } }, { text: prompt }],
        }];
        const config = { responseMimeType: "application/json", responseSchema: schema };

        let result;
        if (this._mock) {
            const start = Date.now();
            result = await this._mock.generate(contents, config);
            recordUsage({ kind: "vision", model: this.modelName, latencyMs: Date.now() - start, ok: true, usageMetadata: result.usageMetadata });
        } else {
            result = await this.generateContentWithRetry(contents, config, 2, "vision", signal);
        }
        const raw = this.getText(result);
        let parsed = {};
        try { parsed = JSON.parse(raw); }
        catch { parsed = JSON.parse((raw.match(/\{[\s\S]*\}/) || ["{}"])[0]); }
        return {
            caption: String(parsed.caption || ""),
            ocrText: String(parsed.ocrText || ""),
            dataInsights: parsed.dataInsights ? String(parsed.dataInsights) : undefined,
            tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).slice(0, 6) : [],
            usage: this.getUsageMetadata(result),
        };
    }

    /**
     * Analyze a PDF page range → [{page, type, description, keyData}].
     * Accepts inline bytes or a pre-uploaded Files-API media part; `pageOffset`
     * is added to the model's page numbers to map a sliced PDF back to the
     * original document's pagination.
     */
    async analyzePdfPages({ buffer, mime = "application/pdf", mediaPart, pageOffset = 0, signal = null } = {}) {
        const prompt = "Analyze every page of this PDF excerpt. For EACH page return one JSON object:\n" +
            '{"page": number (1-based within THIS document), "type": "figure"|"table"|"chart"|"scanned_text", "description": string (what the page shows — for scanned_text include the text content verbatim), "keyData": string (numbers/labels that matter — "" if none)}.\n' +
            "Classify a page as scanned_text only when it is a readable text page with no meaningful figure. Output a JSON array, one entry per page, JSON only.";
        const schema = {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    page: { type: "NUMBER" },
                    type: { type: "STRING", enum: ["figure", "table", "chart", "scanned_text"] },
                    description: { type: "STRING" },
                    keyData: { type: "STRING" },
                },
                required: ["page", "type", "description"],
            },
        };
        const part = mediaPart || { inlineData: { mimeType: mime, data: buffer.toString("base64") } };
        const contents = [{ role: "user", parts: [part, { text: prompt }] }];
        const config = { responseMimeType: "application/json", responseSchema: schema };

        let result;
        if (this._mock) {
            const start = Date.now();
            result = await this._mock.generate(contents, config);
            recordUsage({ kind: "vision", model: this.modelName, latencyMs: Date.now() - start, ok: true, usageMetadata: result.usageMetadata });
        } else {
            result = await this.generateContentWithRetry(contents, config, 2, "vision", signal);
        }
        const raw = this.getText(result);
        let items = [];
        try { items = JSON.parse(raw); }
        catch { items = JSON.parse((raw.match(/\[[\s\S]*\]/) || ["[]"])[0]); }
        if (!Array.isArray(items)) items = [];
        return {
            items: items.map((it) => ({
                page: (parseInt(it.page, 10) || 1) + pageOffset,
                type: ["figure", "table", "chart", "scanned_text"].includes(it.type) ? it.type : "figure",
                description: String(it.description || ""),
                keyData: it.keyData ? String(it.keyData) : undefined,
            })),
            usage: this.getUsageMetadata(result),
        };
    }

    /**
     * NL question → structured table-query spec (never model-written code).
     * Callers validate the returned spec against the column allow-list.
     */
    async planTableQuery(question, { columns, sampleRows, signal = null } = {}) {
        const prompt =
            "Convert the question into a STRUCTURED query spec for a CSV table. Return JSON only, matching this shape:\n" +
            '{"filters": [{"col": string, "op": "eq|ne|gt|gte|lt|lte|in|contains", "value": any}], "groupBy": string[] (≤3), "aggs": [{"col": string, "fn": "sum|avg|count|min|max", "alias"?: string}] (≤5), "orderBy": {"col": string, "dir": "asc|desc"}, "limit": number (≤1000), "chart"?: {"type": "bar|line|pie|scatter", "x": string, "y": string}}.\n' +
            "Only use columns that exist. Omit parts you don't need. If the question can't be expressed as a table query, return {}.\n\n" +
            `COLUMNS: ${JSON.stringify(columns)}\n` +
            `SAMPLE ROWS: ${JSON.stringify((sampleRows || []).slice(0, 5))}\n\n` +
            `QUESTION: ${question}`;
        const schema = {
            type: "OBJECT",
            properties: {
                filters: {
                    type: "ARRAY",
                    items: {
                        type: "OBJECT",
                        properties: {
                            col: { type: "STRING" },
                            op: { type: "STRING", enum: ["eq", "ne", "gt", "gte", "lt", "lte", "in", "contains"] },
                            value: {},
                        },
                        required: ["col", "op"],
                    },
                },
                groupBy: { type: "ARRAY", items: { type: "STRING" } },
                aggs: {
                    type: "ARRAY",
                    items: {
                        type: "OBJECT",
                        properties: {
                            col: { type: "STRING" },
                            fn: { type: "STRING", enum: ["sum", "avg", "count", "min", "max"] },
                            alias: { type: "STRING" },
                        },
                        required: ["col", "fn"],
                    },
                },
                orderBy: {
                    type: "OBJECT",
                    properties: {
                        col: { type: "STRING" },
                        dir: { type: "STRING", enum: ["asc", "desc"] },
                    },
                },
                limit: { type: "NUMBER" },
                chart: {
                    type: "OBJECT",
                    properties: {
                        type: { type: "STRING", enum: ["bar", "line", "pie", "scatter"] },
                        x: { type: "STRING" },
                        y: { type: "STRING" },
                    },
                },
            },
        };

        let result;
        if (this._mock) {
            const start = Date.now();
            result = await this._mock.generate([{ role: "user", parts: [{ text: prompt }] }], { responseMimeType: "application/json", responseSchema: schema });
            recordUsage({ kind: "tool", model: this.modelName, latencyMs: Date.now() - start, ok: true, usageMetadata: result.usageMetadata });
        } else {
            result = await this.generateContentWithRetry(
                [{ role: "user", parts: [{ text: prompt }] }],
                { responseMimeType: "application/json", responseSchema: schema },
                2, "tool", signal
            );
        }
        const raw = this.getText(result);
        try { return { spec: JSON.parse(raw) || {} }; }
        catch {
            try { return { spec: JSON.parse((raw.match(/\{[\s\S]*\}/) || ["{}"])[0]) || {} }; }
            catch { return { spec: null }; }
        }
    }
}

const _instance = new GeminiHelper();
module.exports = _instance;
module.exports.EMBEDDING_DIMS = EMBEDDING_DIMS;
module.exports.classifyError = classifyError;
