const { GoogleGenAI } = require("@google/genai");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const logger = require("../../logger");
const { recordUsage } = require("../telemetry");
const { classifyError } = require("../errors");
const { PROVIDER_CAPABILITIES } = require("../capabilities");
dotenv.config();

// Helper to delay execution
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const EMBEDDING_DIMS = parseInt(process.env.EMBEDDING_DIMS || "768", 10);

/** L2-normalize a vector in place-safe fashion. */
function l2Normalize(values) {
    let norm = 0;
    for (const v of values) norm += v * v;
    norm = Math.sqrt(norm);
    if (!norm || Math.abs(norm - 1) < 1e-6) return values;
    return values.map((v) => v / norm);
}

/**
 * Gemini provider — the only file that imports @google/genai.
 * Exposes the normalized single-attempt interface the router uses
 * (generate / openStream / listModels / embed*) plus the Gemini-only media
 * helpers (upload/delete/transcribe/vision/PDF) reachable through the
 * capability-routed paths and, for backward compatibility, the shim.
 */
class GeminiProvider {
    constructor() {
        this.name = "gemini";
        this.capabilities = PROVIDER_CAPABILITIES.gemini;
        if (!process.env.GEMINI_API_KEY && process.env.GEMINI_MOCK !== "1") {
            logger.error("Missing GEMINI_API_KEY in .env");
        }
        this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "mock" });
        this.modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
        this.fallbackModels = (
            process.env.GEMINI_FALLBACK_MODELS || "gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.6-flash"
        ).split(",");
        this.embeddingModel = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2";
        // Cheap-model lane: titles, summaries, rewrites, memory extraction,
        // rerank — everything that isn't the answer itself.
        this.cheapModelName = process.env.GEMINI_CHEAP_MODEL
            || this.fallbackModels.find((m) => m.includes("lite"))
            || this.fallbackModels[this.fallbackModels.length - 1]
            || this.modelName;
        this.transcribeModelName = process.env.GEMINI_TRANSCRIBE_MODEL || this.modelName;
        this.transcribeModelFallback = false;
        this._mock = process.env.GEMINI_MOCK === "1" ? require("../../geminiMock") : null;
        // API-call counters for cost reporting (evals)
        this.calls = { embed: 0, generate: 0, embedCached: 0 };
    }

    get enabled() {
        return !!process.env.GEMINI_API_KEY || !!this._mock;
    }

    // ------------------------------------------------------------------
    // Normalized provider interface (router-facing)
    // ------------------------------------------------------------------

    /** One generation attempt on a specific model. Records usage. */
    async generate({ model, contents, config = {}, signal, kind = "chat" }) {
        if (this._mock) {
            const start = Date.now();
            const result = await this._mock.generate(contents, config);
            recordUsage({ kind, provider: this.name, model, latencyMs: Date.now() - start, ok: true, usageMetadata: result.usageMetadata });
            return { ...result, provider: this.name, model };
        }
        const start = Date.now();
        this.calls.generate++;
        try {
            const result = await this.ai.models.generateContent({
                model,
                contents,
                config: { ...config, abortSignal: signal || undefined },
            });
            recordUsage({ kind, provider: this.name, model, latencyMs: Date.now() - start, ok: true, usageMetadata: result.usageMetadata });
            // `text`/`functionCalls` are prototype getters on the SDK response —
            // spread drops them, so copy explicitly.
            return {
                ...result,
                text: result.text,
                usageMetadata: result.usageMetadata,
                functionCalls: result.functionCalls,
                provider: this.name,
                model,
            };
        } catch (error) {
            recordUsage({ kind, provider: this.name, model, latencyMs: Date.now() - start, ok: false, errorCode: classifyError(error).code });
            throw error;
        }
    }

    /**
     * Open a stream on a specific model: returns an async iterator of SDK
     * chunks. The router pulls the first chunk eagerly to decide failover;
     * usage is recorded by the router on completion/failure.
     */
    async openStream({ model, contents, config = {}, signal }) {
        if (this._mock) return this._mock.generateStream(contents, config);
        this.calls.generate++;
        const stream = await this.ai.models.generateContentStream({
            model,
            contents,
            config: { ...config, abortSignal: signal || undefined },
        });
        return stream[Symbol.asyncIterator]();
    }

    /** Boot validation: configured models that exist on this key. */
    async listModels({ signal } = {}) {
        if (this._mock) return new Set([this.modelName, ...this.fallbackModels, this.embeddingModel]);
        const pager = await this.ai.models.list({ config: { pageSize: 200 } });
        return new Set((pager.page || []).map((m) => m.name.replace(/^models\//, "")));
    }

    /**
     * Embed text — ONE attempt on the active embedding profile. Embedding
     * failover is intentionally NOT a per-request operation (vector spaces
     * must never mix); the router calls this only.
     */
    async embed({ texts, task = "document", signal }) {
        const taskType = task === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT";
        if (this._mock) {
            return Promise.all((Array.isArray(texts) ? texts : [texts]).map((t) => this._mock.embed(t)));
        }
        const cache = this._embedCache();
        const list = Array.isArray(texts) ? texts : [texts];
        const out = new Array(list.length).fill(null);
        const toFetch = [];
        list.forEach((t, i) => {
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
            recordUsage({ kind: "embed", provider: this.name, model: this.embeddingModel, latencyMs: Date.now() - start, ok: true });
            return out;
        } catch (error) {
            recordUsage({ kind: "embed", provider: this.name, model: this.embeddingModel, latencyMs: Date.now() - start, ok: false, errorCode: classifyError(error).code });
            throw error;
        }
    }

    /**
     * On-disk embedding cache — opt-in via EMBED_CACHE_DIR (evals only).
     * Keyed by sha256(text + model + dims + taskType).
     */
    _embedCache() {
        const dir = process.env.EMBED_CACHE_DIR;
        if (!dir) return null;
        const self = this;
        return {
            read(text, taskType) {
                const key = crypto
                    .createHash("sha256")
                    .update(`${text}|${self.embeddingModel}|${EMBEDDING_DIMS}|${taskType}`)
                    .digest("hex");
                const fp = path.join(dir, `${key}.json`);
                try { return JSON.parse(fs.readFileSync(fp, "utf8")); } catch { return null; }
            },
            write(text, taskType, values) {
                const key = crypto
                    .createHash("sha256")
                    .update(`${text}|${self.embeddingModel}|${EMBEDDING_DIMS}|${taskType}`)
                    .digest("hex");
                try {
                    fs.mkdirSync(dir, { recursive: true });
                    fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify(values));
                } catch { /* cache is best-effort */ }
            },
        };
    }

    // ------------------------------------------------------------------
    // Legacy surface (shim-facing, pre-router behavior preserved)
    // ------------------------------------------------------------------

    /**
     * Generates content with retry for transient errors across the Gemini
     * model chain — used ONLY by the shim when routing within gemini-only
     * legacy calls. The router's own path calls `generate` per model.
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
                    recordUsage({ kind, provider: this.name, model, latencyMs: Date.now() - start, ok: true, usageMetadata: result.usageMetadata });
                    return result;
                } catch (error) {
                    lastError = error;
                    const cls = classifyError(error);
                    recordUsage({ kind, provider: this.name, model, latencyMs: Date.now() - start, ok: false, errorCode: cls.code });
                    if (cls.kind === "daily-quota") {
                        logger.warn({ model }, "[Gemini] daily quota exhausted on model, trying next");
                        break;
                    }
                    const isTransient =
                        error.status === 503 ||
                        error.status === 429 ||
                        (error.message || "").includes("Overloaded");
                    const isModelMissing =
                        error.status === 404 || (error.message || "").includes("not found");
                    if (isModelMissing) break;
                    if (isTransient && attempt < retries) {
                        const waitTime = attempt * 2000;
                        logger.warn({ model, attempt, status: error.status }, "[Gemini] transient error, retrying");
                        await delay(waitTime);
                    } else if (!isTransient) {
                        break;
                    }
                }
            }
        }
        logger.error({ err: lastError?.message }, "[Gemini] Final Failure");
        throw lastError;
    }

    /**
     * Legacy streaming: tries each configured model in turn; a model is
     * skipped only if it fails BEFORE producing its first chunk.
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
                const it = stream[Symbol.asyncIterator]();
                const first = await it.next();
                return (async function* () {
                    try {
                        if (!first.done) yield first.value;
                        for await (const chunk of { [Symbol.asyncIterator]: () => it }) {
                            yield chunk;
                        }
                        recordUsage({ kind, provider: "gemini", model, latencyMs: Date.now() - start, ok: true });
                    } catch (error) {
                        recordUsage({ kind, provider: "gemini", model, latencyMs: Date.now() - start, ok: false, errorCode: classifyError(error).code });
                        throw error;
                    }
                })();
            } catch (error) {
                lastError = error;
                recordUsage({ kind, provider: "gemini", model, latencyMs: Date.now() - start, ok: false, errorCode: classifyError(error).code });
                logger.warn({ model, status: error.status, err: error.message }, "[Gemini] stream failed to start, trying next model");
            }
        }
        logger.error({ err: lastError?.message }, "[Gemini] All models failed to stream");
        throw lastError;
    }

    /** Cheap lane: one attempt per model, cheap first then the chain. */
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
                recordUsage({ kind, provider: this.name, model, latencyMs: Date.now() - start, ok: true, usageMetadata: result.usageMetadata });
                return result;
            } catch (error) {
                lastError = error;
                recordUsage({ kind, provider: this.name, model, latencyMs: Date.now() - start, ok: false, errorCode: classifyError(error).code });
                logger.warn({ model, status: error.status }, "[Gemini] cheap-lane model failed, trying next");
            }
        }
        throw lastError;
    }

    // ------------------------------------------------------------------
    // Shared result accessors (shape normalization helpers)
    // ------------------------------------------------------------------

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

    getResponseParts(result) {
        return result?.candidates?.[0]?.content?.parts || [];
    }

    getUsageMetadata(result) {
        return result?.usageMetadata || null;
    }

    getText(result) {
        if (!result) return "";
        if (typeof result.text === "string") return result.text;
        return result.response?.text?.() || "";
    }

    // ------------------------------------------------------------------
    // Boot/health check
    // ------------------------------------------------------------------

    async verifyConfiguredModels() {
        const requested = process.env.GEMINI_TRANSCRIBE_MODEL;
        const configured = [this.modelName, ...this.fallbackModels, this.embeddingModel];
        const unique = [...new Set([...configured, requested].filter(Boolean))];
        const result = {
            chat: [this.modelName, ...this.fallbackModels],
            embedding: this.embeddingModel,
            transcribe: this.transcribeModelName,
            cheap: this.cheapModelName,
            missing: [],
        };
        if (this._mock) return result;
        try {
            const available = await this.listModels();
            if (!available.has(this.cheapModelName)) {
                logger.warn({ requested: this.cheapModelName, fallback: this.modelName }, "[Gemini] GEMINI_CHEAP_MODEL unavailable — cheap lane falls back to the chat model");
                result.cheap = this.modelName;
            }
            result.missing = unique.filter((m) => !available.has(m));
            if (result.missing.length) {
                logger.warn({ missing: result.missing }, "[Gemini] configured models not available on this key");
            }
            if (requested && !available.has(requested)) {
                this.transcribeModelName = this.modelName;
                this.transcribeModelFallback = true;
                result.transcribe = this.transcribeModelName;
                logger.warn({ requested, fallback: this.modelName }, "[Gemini] GEMINI_TRANSCRIBE_MODEL unavailable — using primary chat model for audio");
            }
        } catch (err) {
            result.missing = unique;
            result.listError = err.message;
        }
        return result;
    }

    // ------------------------------------------------------------------
    // Audio / media (Gemini-only capability)
    // ------------------------------------------------------------------

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
            logger.warn({ name, err: e.message }, "[Gemini] media delete failed");
        }
    }

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
                recordUsage({ kind: "transcribe", provider: this.name, model: this.transcribeModelName, latencyMs: Date.now() - start, ok: true, usageMetadata: result.usageMetadata });
            } else if (this.transcribeModelName !== this.modelName) {
                const start = Date.now();
                try {
                    result = await this.ai.models.generateContent({
                        model: this.transcribeModelName,
                        contents,
                        config: { ...config, abortSignal: signal || undefined },
                    });
                    recordUsage({ kind: "transcribe", provider: this.name, model: this.transcribeModelName, latencyMs: Date.now() - start, ok: true, usageMetadata: result.usageMetadata });
                } catch (e) {
                    recordUsage({ kind: "transcribe", provider: this.name, model: this.transcribeModelName, latencyMs: Date.now() - start, ok: false, errorCode: classifyError(e).code });
                    logger.warn({ model: this.transcribeModelName, err: e.message }, "[Gemini] transcribe model failed — falling back");
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
            return { segments, usage: this.getUsageMetadata(result), model: this.transcribeModelName, provider: this.name };
        } finally {
            if (uploadedName) await this.deleteMedia(uploadedName);
        }
    }

    // ------------------------------------------------------------------
    // Vision (Gemini-only capability)
    // ------------------------------------------------------------------

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
            recordUsage({ kind: "vision", provider: this.name, model: this.modelName, latencyMs: Date.now() - start, ok: true, usageMetadata: result.usageMetadata });
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
            provider: this.name,
        };
    }

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
            recordUsage({ kind: "vision", provider: this.name, model: this.modelName, latencyMs: Date.now() - start, ok: true, usageMetadata: result.usageMetadata });
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
            provider: this.name,
        };
    }

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
            recordUsage({ kind: "tool", provider: this.name, model: this.modelName, latencyMs: Date.now() - start, ok: true, usageMetadata: result.usageMetadata });
        } else {
            result = await this.generateContentWithRetry(
                [{ role: "user", parts: [{ text: prompt }] }],
                { responseMimeType: "application/json", responseSchema: schema },
                2, "tool", signal
            );
        }
        const raw = this.getText(result);
        try { return { spec: JSON.parse(raw) || {}, provider: this.name }; }
        catch {
            try { return { spec: JSON.parse((raw.match(/\{[\s\S]*\}/) || ["{}"])[0]) || {}, provider: this.name }; }
            catch { return { spec: null, provider: this.name }; }
        }
    }

    /**
     * Web-grounded search (Gemini googleSearch tool — Gemini-only
     * capability today; callers gate on capability availability).
     */
    async groundedSearch(contents, { signal } = {}) {
        const config = { tools: [{ googleSearch: {} }] };
        const result = await this.generateContentWithRetry(contents, config, 2, "agent", signal);
        return { result, provider: this.name };
    }
}

module.exports = { GeminiProvider, EMBEDDING_DIMS, delay };
