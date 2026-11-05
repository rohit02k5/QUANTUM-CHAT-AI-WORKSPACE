// Phase 6 — multi-provider router, circuit breaker, degraded modes.
// Uses injected fake providers via llm.__registerProvider / __setChain so
// no live keys are needed. GEMINI_MOCK=1 keeps the gemini provider offline.
const llm = require("../utils/llm");
const { CircuitRegistry } = require("../utils/llm/circuit");
const { classifyError } = require("../utils/llm/errors");
const { CAP } = require("../utils/llm/capabilities");

/** Minimal fake provider for router tests. */
function fakeProvider(name, { caps = [CAP.GENERATE, CAP.STREAM, CAP.STRUCTURED, CAP.TOOLS], behavior } = {}) {
    const calls = { generate: 0, openStream: 0, listModels: 0 };
    return {
        name,
        enabled: true,
        capabilities: new Set(caps),
        calls,
        async generate({ model }) {
            calls.generate++;
            const r = behavior?.generate ? await behavior.generate(model, calls.generate) : null;
            if (r instanceof Error) throw r;
            return { text: r?.text ?? `answer from ${name}:${model}`, usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 }, provider: name, model };
        },
        async openStream({ model }) {
            calls.openStream++;
            const r = behavior?.openStream ? await behavior.openStream(model, calls.openStream) : null;
            if (r instanceof Error) throw r;
            const chunks = r?.chunks ?? [{ text: `streamed from ${name}` }];
            return (async function* () { for (const c of chunks) yield c; })();
        },
        async listModels() {
            calls.listModels++;
            return new Set(behavior?.models ?? ["m1"]);
        },
    };
}

const err = (status, message) => Object.assign(new Error(message), { status });

beforeEach(() => {
    llm.__resetCircuits();
    llm.__registerProvider("fake-a", fakeProvider("fake-a"));
    llm.__registerProvider("fake-b", fakeProvider("fake-b"));
    delete process.env.LLM_ALLOWED_PROVIDERS;
    delete process.env.LLM_PROVIDERS;
    // Ensure tests never accidentally pick env-configured chains
    for (const t of ["ANSWER", "CHEAP", "AGENT", "VISION", "TRANSCRIBE", "JUDGE"]) {
        delete process.env[`LLM_CHAIN_${t}`];
    }
});

describe("6A router — failover and capability gating", () => {
    test("fails over to the next chain entry on transient errors", async () => {
        const a = fakeProvider("fake-a", {
            behavior: { generate: () => err(503, "Overloaded") },
        });
        const b = fakeProvider("fake-b");
        llm.__registerProvider("fake-a", a);
        llm.__registerProvider("fake-b", b);
        process.env.LLM_PROVIDERS = "fake-a,fake-b";
        llm.__setChain("answer", [{ provider: "fake-a", model: "m1" }, { provider: "fake-b", model: "m1" }]);

        const res = await llm.generate({ task: "answer", contents: "hi" });
        expect(res.provider).toBe("fake-b");
        expect(res.fallback).toBe(true);
        expect(res.text).toContain("fake-b");
        expect(a.calls.generate).toBe(1);
        expect(b.calls.generate).toBe(1);
    });

    test("capability gating skips providers lacking the task capability", async () => {
        const noTools = fakeProvider("fake-a", { caps: [CAP.GENERATE, CAP.STREAM] });
        const withTools = fakeProvider("fake-b", { caps: [CAP.TOOLS] });
        llm.__registerProvider("fake-a", noTools);
        llm.__registerProvider("fake-b", withTools);
        process.env.LLM_PROVIDERS = "fake-a,fake-b";
        llm.__setChain("agent", [{ provider: "fake-a", model: "m1" }, { provider: "fake-b", model: "m1" }]);

        const res = await llm.generate({ task: "agent", contents: "hi" });
        expect(res.provider).toBe("fake-b");
        expect(noTools.calls.generate).toBe(0);
    });

    test("LLM_ALLOWED_PROVIDERS restricts which providers may receive content", async () => {
        process.env.LLM_PROVIDERS = "fake-a,fake-b";
        process.env.LLM_ALLOWED_PROVIDERS = "fake-b";
        llm.__setChain("answer", [{ provider: "fake-a", model: "m1" }, { provider: "fake-b", model: "m1" }]);
        const res = await llm.generate({ task: "answer", contents: "hi" });
        expect(res.provider).toBe("fake-b");
    });

    test("all providers down -> AI_NO_PROVIDERS", async () => {
        llm.__registerProvider("fake-a", fakeProvider("fake-a", {
            behavior: { generate: () => err(503, "Overloaded") },
        }));
        llm.__registerProvider("fake-b", fakeProvider("fake-b", {
            behavior: { generate: () => err(503, "Overloaded") },
        }));
        process.env.LLM_PROVIDERS = "fake-a,fake-b";
        llm.__setChain("answer", [{ provider: "fake-a", model: "m1" }, { provider: "fake-b", model: "m1" }]);
        await expect(llm.generate({ task: "answer", contents: "hi" }))
            .rejects.toMatchObject({ noProviders: true });
    });

    test("daily-quota error surfaces AI_QUOTA_EXHAUSTED and opens the circuit", async () => {
        llm.__registerProvider("fake-a", fakeProvider("fake-a", {
            behavior: { generate: () => err(429, "quota exceeded: GenerateRequestsPerDay") },
        }));
        process.env.LLM_PROVIDERS = "fake-a";
        llm.__setChain("answer", [{ provider: "fake-a", model: "m1" }]);
        await expect(llm.generate({ task: "answer", contents: "hi" }))
            .rejects.toMatchObject({ code: "AI_QUOTA_EXHAUSTED" });
        // circuit now open — second call must NOT hit the provider again
        const p = llm.providers.get("fake-a");
        const before = p.calls.generate;
        await expect(llm.generate({ task: "answer", contents: "hi" })).rejects.toBeDefined();
        expect(p.calls.generate).toBe(before);
    });

    test("auth failure disables the provider/model until reset", async () => {
        const p = fakeProvider("fake-a", { behavior: { generate: () => err(401, "invalid api key") } });
        llm.__registerProvider("fake-a", p);
        process.env.LLM_PROVIDERS = "fake-a";
        llm.__setChain("answer", [{ provider: "fake-a", model: "m1" }]);
        await expect(llm.generate({ task: "answer", contents: "hi" })).rejects.toBeDefined();
        const before = p.calls.generate;
        await expect(llm.generate({ task: "answer", contents: "hi" })).rejects.toBeDefined();
        expect(p.calls.generate).toBe(before); // disabled — no retry
    });

    test("invalid-request errors are not retried across the chain", async () => {
        const a = fakeProvider("fake-a", { behavior: { generate: () => err(400, "invalid request") } });
        const b = fakeProvider("fake-b");
        llm.__registerProvider("fake-a", a);
        llm.__registerProvider("fake-b", b);
        process.env.LLM_PROVIDERS = "fake-a,fake-b";
        llm.__setChain("answer", [{ provider: "fake-a", model: "m1" }, { provider: "fake-b", model: "m1" }]);
        await expect(llm.generate({ task: "answer", contents: "hi" })).rejects.toMatchObject({ status: 400 });
        expect(b.calls.generate).toBe(0);
    });
});

describe("6A router — streaming", () => {
    test("fails over before the first token, never after", async () => {
        const a = fakeProvider("fake-a", {
            behavior: { openStream: (model, n) => (n === 1 ? err(503, "Overloaded") : null) },
        });
        const b = fakeProvider("fake-b");
        llm.__registerProvider("fake-a", a);
        llm.__registerProvider("fake-b", b);
        process.env.LLM_PROVIDERS = "fake-a,fake-b";
        llm.__setChain("answer", [{ provider: "fake-a", model: "m1" }, { provider: "fake-b", model: "m1" }]);

        const stream = await llm.stream({ task: "answer", contents: "hi" });
        const chunks = [];
        for await (const c of stream) chunks.push(c);
        expect(chunks[0].provider).toBe("fake-b");
        expect(chunks[0].fallback).toBe(true);
        expect(a.calls.openStream).toBe(1);
    });

    test("mid-stream failure throws (no mid-answer failover)", async () => {
        async function* dying() {
            yield { text: "partial " };
            throw err(500, "died mid-stream");
        }
        const a = fakeProvider("fake-a", { behavior: { openStream: async () => ({ chunks: null, iter: dying() }) } });
        // openStream returns our custom iterator
        a.openStream = async () => dying();
        const b = fakeProvider("fake-b");
        llm.__registerProvider("fake-a", a);
        llm.__registerProvider("fake-b", b);
        process.env.LLM_PROVIDERS = "fake-a,fake-b";
        llm.__setChain("answer", [{ provider: "fake-a", model: "m1" }, { provider: "fake-b", model: "m1" }]);

        const stream = await llm.stream({ task: "answer", contents: "hi" });
        const got = [];
        await expect((async () => { for await (const c of stream) got.push(c); })()).rejects.toBeDefined();
        expect(got.map((c) => c.text).join("")).toBe("partial ");
        expect(b.calls.openStream).toBe(0); // never failed over after first token
    });
});

describe("6A circuit breaker (unit)", () => {
    test("opens after 3 consecutive transient failures; half-open probe closes", () => {
        const now = { t: 0, fn: () => now.t };
        const reg = new CircuitRegistry({ now: () => now.t });
        for (let i = 0; i < 3; i++) reg.failure("p", "m", { kind: "transient" });
        expect(reg.allow("p", "m").allowed).toBe(false); // open
        now.t += 61000; // past max cooldown
        expect(reg.allow("p", "m").state).toBe("half-open");
        reg.success("p", "m");
        expect(reg.allow("p", "m").state).toBe("closed");
    });

    test("daily quota opens until the reported reset", () => {
        const now = { t: 0 };
        const reg = new CircuitRegistry({ now: () => now.t });
        reg.failure("p", "m", { kind: "daily-quota", retryAfterMs: 3600000 });
        expect(reg.allow("p", "m").state).toBe("open");
        now.t += 3599000;
        expect(reg.allow("p", "m").allowed).toBe(false);
        now.t += 2000;
        expect(reg.allow("p", "m").allowed).toBe(true); // probe
    });

    test("auth disables until registry reset (next boot)", () => {
        const reg = new CircuitRegistry();
        reg.failure("p", "m", { kind: "auth" });
        expect(reg.allow("p", "m").allowed).toBe(false);
        expect(reg.allow("p", "m").state).toBe("disabled");
    });

    test("health snapshot has no secrets — names, states, codes only", () => {
        const reg = new CircuitRegistry();
        reg.failure("p", "m", { kind: "transient", errorCode: "AI_UNAVAILABLE" });
        const s = reg.status();
        expect(s[0]).toMatchObject({ provider: "p", model: "m" });
        const blob = JSON.stringify(s);
        expect(blob).not.toMatch(/key|token|secret|Bearer/i);
    });
});

describe("6A classifyError", () => {
    test("daily vs per-minute quota", () => {
        expect(classifyError(err(429, "GenerateRequestsPerDay exceeded")).kind).toBe("daily-quota");
        expect(classifyError(err(429, "rate limit, slow down")).kind).toBe("rate-limit");
    });
    test("auth / 5xx / 404 / invalid", () => {
        expect(classifyError(err(401, "invalid api key")).kind).toBe("auth");
        expect(classifyError(err(503, "Overloaded")).kind).toBe("server");
        expect(classifyError(err(404, "model not found")).kind).toBe("model-missing");
        expect(classifyError(err(400, "invalid")).kind).toBe("invalid-request");
    });
    test("noProviders error keeps quota kind when coded", () => {
        const e = new Error("exhausted");
        e.noProviders = true;
        e.code = "AI_QUOTA_EXHAUSTED";
        expect(classifyError(e).kind).toBe("daily-quota");
    });
});

describe("6A structured output", () => {
    test("zod-validated parse; malformed output repairs then fails", async () => {
        const { z } = require("zod");
        const schema = z.object({ answer: z.string() });
        llm.__registerProvider("fake-a", fakeProvider("fake-a", {
            behavior: { generate: (m, n) => (n === 1 ? { text: "not json" } : { text: '{"answer":"ok"}' }) },
        }));
        process.env.LLM_PROVIDERS = "fake-a";
        llm.__setChain("answer", [{ provider: "fake-a", model: "m1" }]);
        const out = await llm.generateStructured({ task: "answer", contents: "q", zodSchema: schema });
        expect(out.data).toEqual({ answer: "ok" });
    });
});

describe("6A health + metadata", () => {
    test("/health provider block carries no secrets", async () => {
        process.env.LLM_PROVIDERS = "fake-a";
        const status = llm.providerStatus();
        expect(Array.isArray(status)).toBe(true);
        const blob = JSON.stringify(status);
        expect(blob).not.toMatch(/api[_-]?key|Bearer|authorization/i);
        expect(status.find((p) => p.name === "fake-a")).toBeDefined();
    });

    test("geminiHelper shim still works (mock path, provider metadata)", async () => {
        const helper = require("../utils/geminiHelper");
        const res = await helper.generateContentWithRetry("hi");
        expect(helper.getText(res)).toBeTruthy();
        expect(res.provider).toBe("gemini");
        expect(helper.EMBEDDING_DIMS).toBe(768);
    });
});
