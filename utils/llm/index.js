// Multi-provider LLM router (Phase 6).
//
// - Providers register here (gemini SDK, OpenAI-compatible fetch clients,
//   test fakes). No file outside utils/llm/* may import a provider SDK or
//   call a provider URL.
// - Tasks route through env-configured chains ("provider:model,provider:model")
//   gated by capability, LLM_ALLOWED_PROVIDERS, and per-(provider,model)
//   circuit breakers.
// - All responses normalize to the Gemini-shaped envelope existing callers
//   consume ({text, candidates, functionCalls, usageMetadata}) plus
//   additive {provider, model, fallback} metadata.
// - Streams fail over ONLY before the first token; after that the stream
//   ends truncated rather than switching mid-answer.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
dotenv.config();

const logger = require("../logger");
const { getUserId } = require("../requestContext");
const { CircuitRegistry } = require("./circuit");
const { classifyError, circuitKind, noProvidersError } = require("./errors");
const { CAP, PROVIDER_CAPABILITIES, TASK_CAPABILITY } = require("./capabilities");
const { recordUsage } = require("./telemetry");
const { GeminiProvider, EMBEDDING_DIMS } = require("./providers/gemini");
const { createOpenAiCompatProvider, OPENAI_COMPAT_CONFIGS } = require("./providers/openaiCompat");

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_ENTRY_ATTEMPTS = 2; // bounded retries per chain entry

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

const providers = new Map();
providers.set("gemini", new GeminiProvider());
for (const [name, cfg] of Object.entries(OPENAI_COMPAT_CONFIGS)) {
    providers.set(name, createOpenAiCompatProvider(cfg, { capabilities: PROVIDER_CAPABILITIES[name] }));
}

const envList = (v) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);

/** Providers named in LLM_PROVIDERS that are enabled (key present / mock). */
function enabledProviders() {
    const wanted = envList(process.env.LLM_PROVIDERS || "gemini,groq,openrouter");
    return wanted.map((n) => providers.get(n)).filter((p) => p && p.enabled);
}

/** Privacy gate — admins restrict which providers may receive user content. */
function allowedProviders() {
    const allowed = envList(process.env.LLM_ALLOWED_PROVIDERS);
    const enabled = enabledProviders();
    if (!allowed.length) return enabled;
    return enabled.filter((p) => allowed.includes(p.name));
}

// ---------------------------------------------------------------------------
// Chains — "provider:model" comma lists per task lane
// ---------------------------------------------------------------------------

const gem = providers.get("gemini");

function defaultChain(task) {
    // Defaults reproduce pre-Phase-6 behavior exactly: the configured Gemini
    // models, cheap model first for the cheap lane, transcribe model for
    // transcribe. Non-Gemini providers join a chain only via explicit env.
    switch (task) {
        case "answer":
            return [gem.modelName, ...gem.fallbackModels].map((m) => `gemini:${m}`);
        case "cheap":
            return [...new Set([gem.cheapModelName, gem.modelName, ...gem.fallbackModels])].map((m) => `gemini:${m}`);
        case "agent":
            return [gem.modelName, ...gem.fallbackModels].map((m) => `gemini:${m}`);
        case "vision":
            return [gem.modelName, ...gem.fallbackModels].map((m) => `gemini:${m}`);
        case "transcribe":
            return [...new Set([gem.transcribeModelName, gem.modelName, ...gem.fallbackModels])].map((m) => `gemini:${m}`);
        case "judge":
            return [gem.modelName, ...gem.fallbackModels].map((m) => `gemini:${m}`);
        default:
            return [gem.modelName].map((m) => `gemini:${m}`);
    }
}

const CHAIN_ENV = {
    answer: "LLM_CHAIN_ANSWER",
    cheap: "LLM_CHAIN_CHEAP",
    agent: "LLM_CHAIN_AGENT",
    vision: "LLM_CHAIN_VISION",
    transcribe: "LLM_CHAIN_TRANSCRIBE",
    judge: "LLM_CHAIN_JUDGE",
};

const _overriddenChains = new Map(); // test hook

function parseChain(task) {
    if (_overriddenChains.has(task)) return _overriddenChains.get(task);
    const raw = process.env[CHAIN_ENV[task]];
    const entries = (raw ? envList(raw) : defaultChain(task))
        .map((e) => {
            const i = e.indexOf(":");
            if (i < 1) return null;
            return { provider: e.slice(0, i).trim(), model: e.slice(i + 1).trim() };
        })
        .filter(Boolean);
    return entries;
}

const circuits = new CircuitRegistry();

/** Chain entries filtered to allowed providers + declared capability. */
function usableChain(task) {
    const need = TASK_CAPABILITY[task] || CAP.GENERATE;
    const allowed = new Set(allowedProviders().map((p) => p.name));
    return parseChain(task)
        .map((e) => ({ ...e, impl: providers.get(e.provider) }))
        .filter((e) => e.impl && e.impl.enabled && allowed.has(e.provider) && e.impl.capabilities.has(need));
}

// ---------------------------------------------------------------------------
// Disk response cache (dev/eval only — never production)
// ---------------------------------------------------------------------------

const cacheStats = { hits: 0, misses: 0, writes: 0, evictions: 0, singleFlight: 0 };
const inflight = new Map();

function diskCache() {
    if (process.env.LLM_CACHE !== "disk") return null;
    if (process.env.NODE_ENV === "production") return null; // never in prod
    const dir = process.env.LLM_CACHE_DIR || path.join(process.cwd(), ".cache", "llm");
    const ttlMs = parseInt(process.env.LLM_CACHE_TTL_MS || String(7 * 24 * 3600 * 1000), 10);
    const maxEntries = parseInt(process.env.LLM_CACHE_MAX || "500", 10);
    return {
        key(provider, model, task, contents, config, cacheable) {
            if (!cacheable) return null;
            // Never cache media-bearing or oversized requests.
            const norm = JSON.stringify(contents, (k, v) => (k === "data" ? "<omitted>" : v));
            if (norm.length > 200000 || /inlineData|fileData/.test(norm)) return null;
            return crypto.createHash("sha256")
                .update(JSON.stringify({ p: provider, m: model, t: task, c: norm, cfg: normConfig(config), u: getUserId() || "anon" }))
                .digest("hex");
        },
        read(key) {
            const fp = path.join(dir, `${key}.json`);
            try {
                const st = fs.statSync(fp);
                if (Date.now() - st.mtimeMs > ttlMs) { try { fs.unlinkSync(fp); } catch {} return null; }
                return JSON.parse(fs.readFileSync(fp, "utf8"));
            } catch { return null; }
        },
        write(key, value) {
            try {
                fs.mkdirSync(dir, { recursive: true });
                // Cheap eviction: cap total entries by oldest mtime
                const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
                if (files.length >= maxEntries) {
                    const aged = files.map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
                        .sort((a, b) => a.t - b.t).slice(0, Math.ceil(maxEntries * 0.1));
                    for (const { f } of aged) { try { fs.unlinkSync(path.join(dir, f)); cacheStats.evictions++; } catch {} }
                }
                fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify(value));
            } catch { /* best-effort */ }
        },
    };
}

function normConfig(config = {}) {
    const { systemInstruction, temperature, maxOutputTokens, responseMimeType, tools } = config;
    return {
        s: typeof systemInstruction === "string" ? systemInstruction : JSON.stringify(systemInstruction || null),
        t: temperature, m: maxOutputTokens, r: responseMimeType,
        tools: tools ? JSON.stringify(tools) : undefined,
    };
}

// ---------------------------------------------------------------------------
// Core generation (non-streaming)
// ---------------------------------------------------------------------------

/**
 * Route one generation through a task chain.
 * Returns the normalized result plus {provider, model, fallback}.
 * Throws noProvidersError when every candidate is unavailable.
 */
async function generate({ task = "answer", contents, config = {}, kind, signal, cacheable = false }) {
    const chain = usableChain(task);
    if (!chain.length) throw noProvidersError(task, null);
    const cache = diskCache();
    const callKind = kind || (task === "agent" ? "agent" : task === "cheap" ? "chat" : task === "judge" ? "judge" : "chat");

    let lastErr, lastCls;
    for (let idx = 0; idx < chain.length; idx++) {
        const entry = chain[idx];
        const ckey = cache?.key(entry.provider, entry.model, task, contents, config, cacheable);
        if (cache && ckey) {
            const hit = cache.read(ckey);
            if (hit) {
                cacheStats.hits++;
                recordUsage({ kind: callKind, provider: entry.provider, model: entry.model, ok: true, cacheHit: true });
                return { ...hit.result, provider: entry.provider, model: entry.model, fallback: idx > 0, cacheHit: true };
            }
            cacheStats.misses++;
        }

        const gate = circuits.allow(entry.provider, entry.model);
        if (!gate.allowed) {
            lastCls = { kind: gate.state === "disabled" ? "auth" : "server", code: gate.lastErrorCode || "AI_UNAVAILABLE" };
            continue;
        }

        for (let attempt = 1; attempt <= MAX_ENTRY_ATTEMPTS; attempt++) {
            // Mock providers ignore abort (legacy GEMINI_MOCK behavior —
            // tests abort mid-flow and still expect the scripted reply).
            if (signal?.aborted && !entry.impl._mock) throw new Error("aborted");
            try {
                const run = () => entry.impl.generate({ model: entry.model, contents, config, signal, kind: callKind });
                // Single-flight: identical concurrent deterministic calls share one request
                let promise;
                if (cache && ckey) {
                    if (inflight.has(ckey)) { cacheStats.singleFlight++; promise = inflight.get(ckey); }
                    else { promise = run(); inflight.set(ckey, promise); promise.finally(() => inflight.delete(ckey)); }
                } else {
                    promise = run();
                }
                const result = await promise;
                circuits.success(entry.provider, entry.model);
                // `text`/`functionCalls` are prototype getters on SDK response
                // objects — read them explicitly (spread drops them, and the
                // disk cache only serializes enumerable own properties).
                const snap = result && typeof result === "object"
                    ? { ...result, text: result.text, usageMetadata: result.usageMetadata, functionCalls: result.functionCalls }
                    : result;
                const out = { ...(snap || {}), provider: entry.provider, model: entry.model, fallback: idx > 0 };
                if (cache && ckey) {
                    cacheStats.writes++;
                    cache.write(ckey, { result: snap });
                }
                return out;
            } catch (error) {
                if (signal?.aborted || error?.name === "AbortError") {
                    circuits.abort(entry.provider, entry.model);
                    throw error;
                }
                lastErr = error;
                lastCls = classifyError(error);
                const ck = circuitKind(lastCls);
                if (ck) circuits.failure(entry.provider, entry.model, { kind: ck, retryAfterMs: lastCls.retryAfterMs, errorCode: lastCls.code });
                logger.warn({ provider: entry.provider, model: entry.model, task, code: lastCls.code, attempt },
                    "[llm] chain entry failed");

                // Request-scoped failures will fail identically on every
                // provider — surface them instead of burning the chain.
                if (lastCls.kind === "invalid-request" || lastCls.kind === "content-blocked") throw error;

                // Retry same entry once for rate-limit only; everything else
                // moves to the next chain candidate immediately.
                if (lastCls.kind === "rate-limit" && attempt < MAX_ENTRY_ATTEMPTS) {
                    await delay(Math.min(lastCls.retryAfterMs || 2000, 10000));
                    continue;
                }
                break; // next chain entry
            }
        }
    }
    throw lastErr && lastCls && lastCls.kind !== "server" && lastCls.kind !== "daily-quota"
        ? lastErr
        : noProvidersError(task, lastCls);
}

/**
 * Structured generation: JSON-schema config passed through (provider-native
 * where supported) + zod validation, one repair retry, then the error
 * surfaces — failover itself is handled inside generate().
 */
async function generateStructured({ task = "answer", contents, config = {}, zodSchema, signal, kind, cacheable = false }) {
    let attemptContents = contents;
    let lastErr;
    for (let attempt = 1; attempt <= 2; attempt++) {
        if (signal?.aborted) throw new Error("aborted");
        const result = await generate({ task, contents: attemptContents, config, kind, signal, cacheable });
        const text = typeof result.text === "string" ? result.text : "";
        let parsed;
        try { parsed = JSON.parse(text); }
        catch {
            const m = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
            if (m) { try { parsed = JSON.parse(m[0]); } catch { parsed = undefined; } }
        }
        if (parsed !== undefined && zodSchema) {
            const check = zodSchema.safeParse(parsed);
            if (check.success) {
                return { data: check.data, result, provider: result.provider, model: result.model, fallback: result.fallback };
            }
            lastErr = Object.assign(new Error(`structured output failed validation: ${check.error.issues?.[0]?.message || "invalid"}`), { malformed: true });
        } else if (parsed !== undefined) {
            return { data: parsed, result, provider: result.provider, model: result.model, fallback: result.fallback };
        } else {
            lastErr = Object.assign(new Error("malformed structured output"), { malformed: true });
        }
        if (attempt < 2) {
            attemptContents = appendRepair(contents,
                "Your previous output was not valid JSON matching the required schema. Return ONLY the corrected JSON object.");
        }
    }
    throw lastErr;
}

function appendRepair(contents, note) {
    if (typeof contents === "string") return `${contents}\n\n${note}`;
    if (Array.isArray(contents)) return [...contents, { role: "user", parts: [{ text: note }] }];
    return contents;
}

// ---------------------------------------------------------------------------
// Streaming — failover allowed ONLY before the first token
// ---------------------------------------------------------------------------

async function stream({ task = "answer", contents, config = {}, kind = "chat", signal }) {
    const chain = usableChain(task).filter((e) => e.impl.capabilities.has(CAP.STREAM));
    if (!chain.length) throw noProvidersError(task, null);
    let lastErr, lastCls;

    for (let idx = 0; idx < chain.length; idx++) {
        const entry = chain[idx];
        const gate = circuits.allow(entry.provider, entry.model);
        if (!gate.allowed) {
            lastCls = { kind: gate.state === "disabled" ? "auth" : "server", code: gate.lastErrorCode || "AI_UNAVAILABLE" };
            continue;
        }
        if (signal?.aborted && !entry.impl._mock) throw new Error("aborted");
        const start = Date.now();
        try {
            const it = await entry.impl.openStream({ model: entry.model, contents, config, signal });
            // Eagerly pull the first chunk — failure here = "failed to start",
            // safe to fail over since the caller has seen nothing yet.
            const first = await it.next();
            const provider = entry.provider, model = entry.model, fallback = idx > 0;
            return (async function* () {
                try {
                    // NOTE: `text` is a prototype getter on SDK response objects —
                    // object spread does NOT copy it. Read it explicitly.
                    if (!first.done) yield { ...(first.value || {}), text: first.value?.text, provider, model, fallback };
                    for await (const chunk of { [Symbol.asyncIterator]: () => it }) {
                        yield { ...(chunk || {}), text: chunk?.text, provider, model, fallback };
                    }
                    circuits.success(provider, model);
                    recordUsage({ kind, provider, model, latencyMs: Date.now() - start, ok: true, fallback });
                } catch (error) {
                    // Mid-stream failure: NEVER fail over — caller ends truncated.
                    const cls = classifyError(error);
                    recordUsage({ kind, provider, model, latencyMs: Date.now() - start, ok: false, errorCode: cls.code, fallback });
                    throw error;
                }
            })();
        } catch (error) {
            if (signal?.aborted || error?.name === "AbortError") {
                circuits.abort(entry.provider, entry.model);
                throw error;
            }
            lastErr = error;
            lastCls = classifyError(error);
            const ck = circuitKind(lastCls);
            if (ck) circuits.failure(entry.provider, entry.model, { kind: ck, retryAfterMs: lastCls.retryAfterMs, errorCode: lastCls.code });
            recordUsage({ kind, provider: entry.provider, model: entry.model, latencyMs: Date.now() - start, ok: false, errorCode: lastCls.code });
            logger.warn({ provider: entry.provider, model: entry.model, task, code: lastCls.code }, "[llm] stream failed to start — next chain entry");
            if (lastCls.kind === "invalid-request" || lastCls.kind === "content-blocked") throw error;
        }
    }
    throw lastErr && lastCls && lastCls.kind !== "server" && lastCls.kind !== "daily-quota"
        ? lastErr
        : noProvidersError(task, lastCls);
}

// ---------------------------------------------------------------------------
// Embeddings — ONE active profile, no per-request failover
// ---------------------------------------------------------------------------

function embeddingProvider() {
    return allowedProviders().find((p) => p.capabilities.has(CAP.EMBED)) || null;
}

async function embed({ texts, task = "document", signal }) {
    const p = embeddingProvider();
    if (!p || typeof p.embed !== "function") throw noProvidersError("embed", null);
    return p.embed({ texts, task, signal });
}

/** Cheap availability probe for degraded-mode decisions (no API call). */
function embeddingAvailable() {
    const p = embeddingProvider();
    if (!p) return false;
    const gate = circuits.allow(p.name, p.embeddingModel || "default");
    return gate.allowed;
}

function generationAvailable(task = "answer") {
    return usableChain(task).some((e) => circuits.allow(e.provider, e.model).allowed);
}

// ---------------------------------------------------------------------------
// Capability-routed services (vision / transcribe / pdf / grounded search)
// ---------------------------------------------------------------------------

async function _capabilityCall(task, cap, fnName, args) {
    const seen = new Set();
    const candidates = usableChain(task)
        .filter((e) => typeof e.impl[fnName] === "function")
        .filter((e) => (seen.has(e.provider) ? false : (seen.add(e.provider), true)));
    const fallbackPool = candidates.length ? candidates
        : allowedProviders()
            .filter((p) => p.capabilities.has(cap) && typeof p[fnName] === "function")
            .map((p) => ({ provider: p.name, model: p.modelName || "default", impl: p }));
    if (!fallbackPool.length) throw noProvidersError(task, null);
    let lastErr;
    for (const e of fallbackPool) {
        const gate = circuits.allow(e.provider, e.model);
        if (!gate.allowed) continue;
        try {
            const out = await e.impl[fnName](...args);
            circuits.success(e.provider, e.model);
            return out;
        } catch (error) {
            lastErr = error;
            const cls = classifyError(error);
            const ck = circuitKind(cls);
            if (ck) circuits.failure(e.provider, e.model, { kind: ck, retryAfterMs: cls.retryAfterMs, errorCode: cls.code });
        }
    }
    throw lastErr || noProvidersError(task, null);
}

const transcribe = (buffer, opts) => _capabilityCall("transcribe", CAP.TRANSCRIBE, "transcribeAudio", [buffer, opts]);
const describeImage = (buffer, opts) => _capabilityCall("vision", CAP.VISION, "describeImage", [buffer, opts]);
const analyzePdf = (opts) => _capabilityCall("vision", CAP.PDF, "analyzePdfPages", [opts]);
const groundedSearch = (contents, opts) => _capabilityCall("answer", CAP.GROUNDED_SEARCH, "groundedSearch", [contents, opts]);

// ---------------------------------------------------------------------------
// Boot validation + health
// ---------------------------------------------------------------------------

let _chainWarnings = [];

/**
 * Validate every chain entry against each provider's model list. Unknown
 * models are dropped (warning logged — provider/model only, never keys).
 * A provider whose model list can't be fetched keeps its entries; real
 * calls will sort it out through the circuit.
 */
async function bootValidate() {
    _chainWarnings = [];
    const modelLists = new Map();
    for (const p of enabledProviders()) {
        try {
            modelLists.set(p.name, await p.listModels());
        } catch (e) {
            _chainWarnings.push({ provider: p.name, warning: "model-list unavailable — entries unverified", code: classifyError(e).code });
        }
    }
    for (const task of Object.keys(CHAIN_ENV)) {
        const entries = parseChain(task);
        const kept = [];
        for (const e of entries) {
            const impl = providers.get(e.provider);
            if (!impl || !impl.enabled) {
                _chainWarnings.push({ provider: e.provider, model: e.model, task, warning: "provider disabled (no key?)" });
                continue;
            }
            const list = modelLists.get(e.provider);
            if (list && !list.has(e.model)) {
                _chainWarnings.push({ provider: e.provider, model: e.model, task, warning: "model not in provider list — dropped" });
                continue;
            }
            kept.push(e);
        }
        _overriddenChains.set(task, kept);
    }
    // Gemini-specific legacy verification (cheap/transcribe fallback logic)
    const gemCheck = providers.get("gemini").enabled
        ? await providers.get("gemini").verifyConfiguredModels()
        : { missing: [] };
    return { warnings: _chainWarnings, gemini: gemCheck };
}

/** /health block — provider names, states, models, error codes. No secrets. */
function providerStatus() {
    const circ = new Map(circuits.status().map((s) => [`${s.provider}:${s.model}`, s]));
    return enabledProviders().map((p) => {
        const tasks = {};
        for (const task of Object.keys(CHAIN_ENV)) {
            tasks[task] = parseChain(task).filter((e) => e.provider === p.name).map((e) => e.model);
        }
        const models = [...new Set(Object.values(tasks).flat())];
        const states = models.map((m) => circ.get(`${p.name}:${m}`)).filter(Boolean);
        const worst = states.some((s) => s.state === "open") ? "open"
            : states.some((s) => s.state === "disabled") ? "disabled"
            : states.some((s) => s.state === "half-open") ? "half-open" : "closed";
        const next = states.filter((s) => s.reopensAt).map((s) => s.reopensAt).sort()[0];
        const lastErr = states.map((s) => s.lastErrorCode).filter(Boolean)[0];
        return {
            name: p.name,
            enabled: true,
            allowed: allowedProviders().includes(p),
            capabilities: [...p.capabilities],
            models,
            state: worst,
            reopensAt: next,
            lastErrorCode: lastErr,
        };
    });
}

// ---------------------------------------------------------------------------
// Test hooks
// ---------------------------------------------------------------------------

function __registerProvider(name, impl) {
    providers.set(name, impl);
}
function __setChain(task, entries) {
    _overriddenChains.set(task, entries);
}
function __resetCircuits() {
    circuits.reset();
    _overriddenChains.clear();
}
function __cacheStats() {
    return cacheStats;
}

module.exports = {
    EMBEDDING_DIMS,
    generate,
    generateStructured,
    stream,
    embed,
    transcribe,
    describeImage,
    analyzePdf,
    groundedSearch,
    embeddingAvailable,
    generationAvailable,
    bootValidate,
    providerStatus,
    classifyError,
    enabledProviders,
    allowedProviders,
    usableChain,
    gemini: gem,
    providers,
    __registerProvider,
    __setChain,
    __resetCircuits,
    __cacheStats,
};
