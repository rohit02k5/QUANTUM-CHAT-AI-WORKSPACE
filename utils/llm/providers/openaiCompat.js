// Generic OpenAI-compatible chat-completions provider over fetch — covers
// Groq and OpenRouter with no new dependency. The ONLY file (besides
// providers/gemini.js) that talks to a provider URL. Base URLs come from env
// only; callers can never inject one (SSRF-safe by construction).
//
// Normalizes everything into the Gemini-shaped envelope existing callers
// consume: { text, candidates, functionCalls, usageMetadata, provider, model }.

function envTimeout() {
    return parseInt(process.env.LLM_REQUEST_TIMEOUT_MS || "60000", 10);
}

/** Error with .status so the shared classifier works uniformly. */
function httpError(status, bodyText) {
    let msg = `HTTP ${status}`;
    try {
        const j = JSON.parse(bodyText);
        msg = j?.error?.message || j?.message || msg;
    } catch { /* keep default */ }
    const e = new Error(msg);
    e.status = status;
    return e;
}

/** Gemini contents -> OpenAI messages. Text-only; media parts are dropped
 *  (these providers are never routed media-capable tasks). */
function toMessages(contents, config) {
    const msgs = [];
    if (config?.systemInstruction) {
        const sys = typeof config.systemInstruction === "string"
            ? config.systemInstruction
            : config.systemInstruction?.parts?.map((p) => p.text).join("\n");
        if (sys) msgs.push({ role: "system", content: sys });
    }
    const list = typeof contents === "string"
        ? [{ role: "user", parts: [{ text: contents }] }]
        : (Array.isArray(contents) ? contents : []);
    for (const c of list) {
        const parts = c?.parts || [];
        const texts = parts.filter((p) => typeof p?.text === "string").map((p) => p.text).join("\n");
        const fcs = parts.filter((p) => p?.functionCall).map((p) => p.functionCall);
        const frs = parts.filter((p) => p?.functionResponse).map((p) => p.functionResponse);
        if (fcs.length) {
            msgs.push({
                role: "assistant",
                content: texts || null,
                tool_calls: fcs.map((fc, i) => ({
                    id: fc.id || `call_${i}`,
                    type: "function",
                    function: { name: fc.name, arguments: JSON.stringify(fc.args || {}) },
                })),
            });
            continue;
        }
        if (frs.length) {
            for (const fr of frs) {
                msgs.push({
                    role: "tool",
                    tool_call_id: fr.id || fr.name,
                    name: fr.name,
                    content: typeof fr.response === "string" ? fr.response : JSON.stringify(fr.response ?? {}),
                });
            }
            continue;
        }
        msgs.push({ role: c?.role === "model" ? "assistant" : (c?.role || "user"), content: texts || "" });
    }
    return msgs;
}

/** Gemini tools config -> OpenAI tools array. */
function toTools(config) {
    const decls = (config?.tools || []).flatMap((t) => t.functionDeclarations || []);
    if (!decls.length) return undefined;
    return decls.map((d) => ({
        type: "function",
        function: { name: d.name, description: d.description || "", parameters: d.parameters || {} },
    }));
}

/** OpenAI chat.completion -> Gemini-shaped envelope. */
function fromCompletion(json, provider, model) {
    const choice = json?.choices?.[0] || {};
    const msg = choice.message || {};
    const text = typeof msg.content === "string" ? msg.content : "";
    const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    const functionCalls = toolCalls
        .filter((tc) => tc?.function?.name)
        .map((tc) => {
            let args = {};
            try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* keep {} */ }
            return { id: tc.id, name: tc.function.name, args };
        });
    const parts = [
        ...(text ? [{ text }] : []),
        ...functionCalls.map((fc) => ({ functionCall: { id: fc.id, name: fc.name, args: fc.args } })),
    ];
    return {
        text,
        candidates: [{ content: { role: "model", parts }, finishReason: choice.finish_reason }],
        functionCalls,
        usageMetadata: {
            promptTokenCount: json?.usage?.prompt_tokens || 0,
            candidatesTokenCount: json?.usage?.completion_tokens || 0,
        },
        provider,
        model: json?.model || model,
    };
}

/**
 * Factory: build a provider for an OpenAI-compatible endpoint.
 * cfg = { name, apiKeyEnv, baseUrlEnv, defaultBaseUrl, capabilities }
 */
function createOpenAiCompatProvider(cfg, { fetchImpl, capabilities } = {}) {
    const doFetch = fetchImpl || globalThis.fetch;
    const provider = {
        name: cfg.name,
        capabilities: capabilities || new Set(["generate", "stream", "structured", "tools"]),
        get apiKey() { return process.env[cfg.apiKeyEnv]; },
        get baseUrl() { return (process.env[cfg.baseUrlEnv] || cfg.defaultBaseUrl).replace(/\/$/, ""); },
        get enabled() { return !!this.apiKey && !!doFetch; },

        headers() {
            // The key is never logged, never returned, never embedded in URLs.
            return { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` };
        },

        combinedSignal(signal, ms = envTimeout()) {
            const sigs = [AbortSignal.timeout(ms)];
            if (signal) sigs.push(signal);
            return AbortSignal.any(sigs);
        },

        body(model, contents, config, extra = {}) {
            const b = {
                model,
                messages: toMessages(contents, config),
                ...(config?.temperature !== undefined ? { temperature: config.temperature } : {}),
                ...(config?.maxOutputTokens ? { max_tokens: config.maxOutputTokens } : {}),
                ...extra,
            };
            const tools = toTools(config);
            if (tools) b.tools = tools;
            if (config?.responseMimeType === "application/json" || config?.responseSchema) {
                b.response_format = { type: "json_object" };
            }
            return b;
        },

        /** One non-streaming generation attempt on a specific model. */
        async generate({ model, contents, config = {}, signal }) {
            const res = await doFetch(`${this.baseUrl}/chat/completions`, {
                method: "POST",
                headers: this.headers(),
                body: JSON.stringify(this.body(model, contents, config)),
                signal: this.combinedSignal(signal),
            });
            const text = await res.text();
            if (!res.ok) throw httpError(res.status, text);
            let json;
            try { json = JSON.parse(text); }
            catch {
                const e = new Error("malformed JSON from provider");
                e.malformed = true;
                throw e;
            }
            return fromCompletion(json, this.name, model);
        },

        /**
         * Open a stream: returns an async iterator of normalized chunks
         * ({text} plus a final {usageMetadata} if the provider sends usage).
         * The ROUTER pulls the first chunk to decide failover — this just
         * hands back the iterator.
         */
        async openStream({ model, contents, config = {}, signal }) {
            const res = await doFetch(`${this.baseUrl}/chat/completions`, {
                method: "POST",
                headers: this.headers(),
                body: JSON.stringify(this.body(model, contents, config, { stream: true })),
                signal: this.combinedSignal(signal),
            });
            if (!res.ok) throw httpError(res.status, await res.text());
            const providerName = this.name;
            return (async function* () {
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buf = "";
                try {
                    for (;;) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        buf += decoder.decode(value, { stream: true });
                        const lines = buf.split("\n");
                        buf = lines.pop() || "";
                        for (const line of lines) {
                            const l = line.trim();
                            if (!l.startsWith("data:")) continue;
                            const payload = l.slice(5).trim();
                            if (payload === "[DONE]") return;
                            let json;
                            try { json = JSON.parse(payload); } catch { continue; }
                            const delta = json?.choices?.[0]?.delta?.content;
                            if (delta) yield { text: delta };
                            if (json?.usage) {
                                yield { usageMetadata: {
                                    promptTokenCount: json.usage.prompt_tokens || 0,
                                    candidatesTokenCount: json.usage.completion_tokens || 0,
                                } };
                            }
                        }
                    }
                } finally {
                    try { reader.cancel(); } catch { /* closed */ }
                }
            })();
        },

        /** Boot validation: verify configured models exist on this key. */
        async listModels({ signal } = {}) {
            const res = await doFetch(`${this.baseUrl}/models`, {
                headers: this.headers(),
                signal: this.combinedSignal(signal, 10000),
            });
            const text = await res.text();
            if (!res.ok) throw httpError(res.status, text);
            let json;
            try { json = JSON.parse(text); } catch { return new Set(); }
            return new Set((json?.data || []).map((m) => m.id).filter(Boolean));
        },
    };
    return provider;
}

/** Registry of known OpenAI-compatible provider configs. */
const OPENAI_COMPAT_CONFIGS = {
    groq: {
        name: "groq",
        apiKeyEnv: "GROQ_API_KEY",
        baseUrlEnv: "GROQ_BASE_URL",
        defaultBaseUrl: "https://api.groq.com/openai/v1",
    },
    openrouter: {
        name: "openrouter",
        apiKeyEnv: "OPENROUTER_API_KEY",
        baseUrlEnv: "OPENROUTER_BASE_URL",
        defaultBaseUrl: "https://openrouter.ai/api/v1",
    },
};

module.exports = { createOpenAiCompatProvider, OPENAI_COMPAT_CONFIGS };
