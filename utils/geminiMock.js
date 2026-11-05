const crypto = require("crypto");
const dotenv = require("dotenv");
dotenv.config();

const DIMS = parseInt(process.env.EMBEDDING_DIMS || "768", 10);

/**
 * Deterministic Gemini stand-in for tests (GEMINI_MOCK=1).
 * - embed(): hash-seeded pseudo-random vector. Texts that share a common
 *   prefix token produce cosine-similar vectors, so retrieval ranking is
 *   testable. ("SIM:<token>:rest" forces near-identical vectors per token.)
 * - generate(): returns canned text shaped like the SDK response.
 */
/** Expand a string into `n` deterministic pseudo-random bytes via counter hashing. */
function expandHash(str, n) {
    const out = new Uint8Array(n);
    let block = 0, produced = 0;
    while (produced < n) {
        const h = crypto.createHash("sha256").update(`${str}#${block++}`).digest();
        const take = Math.min(32, n - produced);
        out.set(h.subarray(0, take), produced);
        produced += take;
    }
    return out;
}

function embed(text) {
    const str = String(text || "");
    // Extract a similarity token if present: "SIM:docsim rest..." lets tests
    // control which chunks cluster together.
    const m = str.match(/^SIM:([a-z0-9_-]+)/i);
    const seedStr = m ? `sim-${m[1].toLowerCase()}` : str.slice(0, 4000);
    // Expand seed + noise hashes to cover all dims. ~80% of dims come from the
    // SIM-token seed so same-token texts land well above the 0.5 min-score.
    const shared = Math.floor(DIMS * 0.8);
    const seed = expandHash(seedStr, shared);
    const noise = expandHash(str, DIMS - shared);
    const out = new Array(DIMS);
    for (let i = 0; i < DIMS; i++) {
        const b = i < shared ? seed[i] : noise[i - shared];
        out[i] = (b / 255) * 2 - 1;
    }
    // L2 normalize
    let n = 0;
    for (const v of out) n += v * v;
    n = Math.sqrt(n);
    return Promise.resolve(out.map((v) => v / n));
}

/**
 * Deterministic multi-turn scripting for agent tests.
 * __setAgentScript([
 *   {functionCalls: [{name:"search_knowledge_base", args:{query:"x"}}]},
 *   {functionCalls: [...]},
 *   {text: "final answer"},
 * ])
 * Each generate() call with tools present shifts one turn; a turn with
 * `functionCalls` returns SDK-shaped functionCall parts, `{text}` returns a
 * normal text turn. Script exhausted → plain text response.
 */
let agentScript = null;
function __setAgentScript(script) {
    agentScript = Array.isArray(script) ? script.map((t) => ({ ...t })) : null;
}

const isGoogleSearchCall = (config) =>
    Array.isArray(config?.tools) && config.tools.some((t) => t.googleSearch);

// --- audio / media tracking (tests assert upload+delete lifecycle) ---
let mediaFiles = [];
let transcriptScript = null; // (window|null) => segments[]
function __uploadMedia(buffer, mime) {
    const f = { name: `files/mock-${mediaFiles.length + 1}`, uri: `files/mock-${mediaFiles.length + 1}`, mimeType: mime, size: buffer.length, deleted: false };
    mediaFiles.push(f);
    return Promise.resolve(f);
}
function __deleteMedia(name) {
    const f = mediaFiles.find((x) => x.name === name);
    if (f) f.deleted = true;
}
function __mediaFiles() { return mediaFiles; }
function __resetMedia() { mediaFiles = []; transcriptScript = null; }
function __setTranscript(fn) { transcriptScript = fn; }

/** Find media parts + prompt text inside a contents array. */
function mediaParts(prompt) {
    const contents = Array.isArray(prompt) ? prompt : [];
    const parts = contents.flatMap((c) => c?.parts || []);
    const media = parts.filter((p) => p.inlineData || p.fileData);
    const texts = parts.filter((p) => typeof p.text === "string").map((p) => p.text);
    return { media, texts };
}

const defaultSegments = (w) => {
    const segs = [
        { startSec: 0, endSec: 5.5, speaker: "Speaker 1", text: "Mock transcript: hello and welcome to the Quantum project sync." },
        { startSec: 5.5, endSec: 12, speaker: "Speaker 2", text: "We reviewed the roadmap and assigned the ingestion work." },
        { startSec: 12, endSec: 20, speaker: "Speaker 1", text: "Decision: ship Phase 3A with GridFS storage and audio." },
        { startSec: 20, endSec: 30, speaker: "Speaker 2", text: "Action item: verify the Atlas cluster before Friday." },
    ];
    if (!w) return segs;
    return segs
        .filter((s) => s.endSec > w.startSec && s.startSec < w.endSec)
        .map((s) => ({ ...s, startSec: Math.max(s.startSec, w.startSec), endSec: Math.min(s.endSec, w.endSec) }));
};

function generate(prompt, config = {}) {
    const text = typeof prompt === "string" ? prompt : JSON.stringify(prompt);

    // Audio transcription call — contents carry an audio part
    const { media, texts } = mediaParts(prompt);
    if (media.length) {
        const promptText = texts.join("\n");
        const wm = promptText.match(/between (\d+(?:\.\d+)?) seconds and (\d+(?:\.\d+)?) seconds/i);
        const window = wm ? { startSec: parseFloat(wm[1]), endSec: parseFloat(wm[2]) } : null;
        const segs = transcriptScript ? transcriptScript(window) : defaultSegments(window);
        return Promise.resolve({
            text: JSON.stringify(segs),
            usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20 },
        });
    }

    // Web-search grounding call (separate request, googleSearch tool only)
    if (isGoogleSearchCall(config)) {
        return Promise.resolve({
            text: "web-search mock answer [1]",
            candidates: [{ content: { role: "model", parts: [{ text: "web-search mock answer [1]" }] } }],
            groundingMetadata: {
                groundingChunks: [
                    { web: { title: "Example Source", uri: "https://example.com/a" } },
                ],
            },
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        });
    }

    // Scripted agent turn (only when function tools are declared)
    const hasFunctionTools =
        Array.isArray(config?.tools) && config.tools.some((t) => t.functionDeclarations?.length);
    if (hasFunctionTools && agentScript && agentScript.length) {
        const turn = agentScript.shift();
        if (turn.functionCalls?.length) {
            const parts = turn.functionCalls.map((fc) => ({
                functionCall: { name: fc.name, args: fc.args || {} },
            }));
            return Promise.resolve({
                text: "",
                candidates: [{ content: { role: "model", parts } }],
                functionCalls: turn.functionCalls.map((fc) => ({ name: fc.name, args: fc.args || {} })),
                usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
            });
        }
        return Promise.resolve({
            text: turn.text || "mock agent answer",
            candidates: [{ content: { role: "model", parts: [{ text: turn.text || "mock agent answer" }] } }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        });
    }

    let response = "mock response";

    // Meeting minutes calls get a schema-shaped structured answer
    if (/meeting minutes/i.test(text)) {
        response = JSON.stringify({
            summary: "Mock meeting summary of the transcript.",
            decisions: [{ text: "Ship Phase 3A", sourceSec: 12 }],
            actionItems: [{ owner: "Speaker 2", task: "Verify Atlas cluster", due: "Friday", sourceSec: 20 }],
            openQuestions: [{ text: "Who owns the eval?", sourceSec: 25 }],
            risks: [{ text: "Free-tier rate limits", sourceSec: 28 }],
        });
    } else if (config.responseMimeType === "application/json" || config.responseSchema) {
        response = JSON.stringify({
            supported: true,
            supportedClaims: 1,
            totalClaims: 1,
            score: 0.9,
            relevant: true,
            reason: "mock judge",
        });
    } else if (/mindmap/i.test(text)) {
        response = "mindmap\n  root((Mock))\n    (\"A\")\n    (\"B\")";
    } else if (/title/i.test(text)) {
        response = "Mock Chat Title";
    }
    return Promise.resolve({ text: response, usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } });
}

async function* generateStream(prompt, config) {
    const res = await generate(prompt, config);
    for (const word of String(res.text).split(" ")) {
        // Pacing delay so tests can abort mid-stream realistically
        await new Promise((r) => setTimeout(r, 200));
        yield { text: word + " " };
    }
}

module.exports = {
    embed,
    generate,
    generateStream,
    __setAgentScript,
    __uploadMedia,
    __deleteMedia,
    __mediaFiles,
    __resetMedia,
    __setTranscript,
};
