// Capability names for the normalized provider interface. A provider may
// only serve a task when it declares the matching capability — the router
// gates on this before circuit state or failover.
const CAP = {
    GENERATE: "generate",           // single-shot text generation
    STREAM: "stream",               // streaming text generation
    STRUCTURED: "structured",       // JSON-schema constrained output
    TOOLS: "tools",                 // function/tool calling
    EMBED: "embed",                 // text embeddings (single active profile only)
    TRANSCRIBE: "transcribe",       // audio -> timestamped segments
    VISION: "vision",               // image description
    PDF: "pdf",                     // multi-page PDF deep analysis
    GROUNDED_SEARCH: "groundedSearch", // provider-native web search grounding
};

// What each built-in provider can do. Keys are provider names matching
// LLM_PROVIDERS entries.
const PROVIDER_CAPABILITIES = {
    gemini: new Set([
        CAP.GENERATE, CAP.STREAM, CAP.STRUCTURED, CAP.TOOLS, CAP.EMBED,
        CAP.TRANSCRIBE, CAP.VISION, CAP.PDF, CAP.GROUNDED_SEARCH,
    ]),
    groq: new Set([CAP.GENERATE, CAP.STREAM, CAP.STRUCTURED, CAP.TOOLS]),
    openrouter: new Set([CAP.GENERATE, CAP.STREAM, CAP.STRUCTURED, CAP.TOOLS]),
};

// Capability each task lane requires. Task lanes map to LLM_CHAIN_* envs.
const TASK_CAPABILITY = {
    answer: CAP.GENERATE,
    cheap: CAP.GENERATE,
    agent: CAP.TOOLS,
    vision: CAP.VISION,
    transcribe: CAP.TRANSCRIBE,
    judge: CAP.STRUCTURED,
    embed: CAP.EMBED,
    pdf: CAP.PDF,
    groundedSearch: CAP.GROUNDED_SEARCH,
};

module.exports = { CAP, PROVIDER_CAPABILITIES, TASK_CAPABILITY };
