// Thin compatibility shim (Phase 6). The implementation now lives in the
// provider layer — utils/llm/* is the only place provider SDKs and URLs
// exist. This file preserves the pre-Phase-6 function names/signatures so
// existing callers and tests keep working while internal callers migrate
// gradually.
const llm = require("./llm");
const gem = llm.gemini; // the Gemini provider instance (media helpers, config)

const EMBEDDING_DIMS = llm.EMBEDDING_DIMS;

const cacheable = (config) => config?.temperature === 0 || process.env.LLM_CACHEABLE === "1";

const _formatChat = (history, prompt) => {
    const historyText = (history || [])
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.parts?.[0]?.text || ""}`)
        .join("\n");
    return historyText
        ? `${historyText}\n\nUser: ${prompt}\nAssistant:`
        : `User: ${prompt}\nAssistant:`;
};

const shim = {
    // Config surface — delegated to the Gemini provider
    get ai() { return gem.ai; },
    get modelName() { return gem.modelName; },
    get fallbackModels() { return gem.fallbackModels; },
    get embeddingModel() { return gem.embeddingModel; },
    get cheapModelName() { return gem.cheapModelName; },
    get transcribeModelName() { return gem.transcribeModelName; },
    get transcribeModelFallback() { return gem.transcribeModelFallback; },
    get calls() { return gem.calls; },
    get _mock() { return gem._mock; },

    // Embeddings — single active profile, no per-request failover
    async getEmbedding(text, { task = "document" } = {}) {
        const out = await llm.embed({ texts: [text], task });
        return out[0];
    },
    async getEmbeddings(texts, { task = "document" } = {}) {
        if (!Array.isArray(texts)) return [];
        return llm.embed({ texts, task });
    },

    // Generation — routed through the task chains (multi-provider capable).
    // Deterministic calls (temperature 0 or LLM_CACHEABLE=1 for dev/eval)
    // are eligible for the disk cache; nothing is cached in production.
    async generateContentWithRetry(prompt, config = {}, retries = 3, kind = "chat", signal = null) {
        return llm.generate({ task: "answer", contents: prompt, config, kind, signal, cacheable: cacheable(config) });
    },
    async generateContentStream(prompt, config = {}, kind = "chat", signal = null) {
        return llm.stream({ task: "answer", contents: prompt, config, kind, signal });
    },
    async generateChatStream(history, prompt, config = {}, signal = null) {
        return llm.stream({ task: "answer", contents: _formatChat(history, prompt), config, kind: "chat", signal });
    },
    async generateChatWithRetry(history, prompt, retries = 3, config = {}) {
        return llm.generate({ task: "answer", contents: _formatChat(history, prompt), config, kind: "chat", cacheable: cacheable(config) });
    },
    async generateCheapest(prompt, config = {}, kind = "chat", signal = null) {
        return llm.generate({ task: "cheap", contents: prompt, config, kind, signal, cacheable: cacheable(config) });
    },
    async generateAgentTurn(contents, config = {}, signal = null) {
        return llm.generate({ task: "agent", contents, config, kind: "agent", signal });
    },

    // Result accessors — pure shape helpers on the Gemini provider
    getFunctionCalls(result) { return gem.getFunctionCalls(result); },
    getResponseParts(result) { return gem.getResponseParts(result); },
    getUsageMetadata(result) { return gem.getUsageMetadata(result); },
    getText(result) { return gem.getText(result); },

    // Boot verification — validates all chains/providers, legacy shape out
    async verifyConfiguredModels() {
        const r = await llm.bootValidate();
        return r.gemini;
    },

    // Gemini-only capabilities — capability-routed through the router
    async uploadMedia(buffer, mime, displayName) { return gem.uploadMedia(buffer, mime, displayName); },
    async deleteMedia(name) { return gem.deleteMedia(name); },
    async transcribeAudio(buffer, opts) { return llm.transcribe(buffer, opts); },
    async describeImage(buffer, opts) { return llm.describeImage(buffer, opts); },
    async analyzePdfPages(opts) { return llm.analyzePdf(opts); },
    async planTableQuery(question, opts) { return gem.planTableQuery(question, opts); },
};

module.exports = shim;
module.exports.EMBEDDING_DIMS = EMBEDDING_DIMS;
module.exports.classifyError = llm.classifyError;
