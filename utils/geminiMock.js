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

function generate(prompt, config = {}) {
    const text = typeof prompt === "string" ? prompt : JSON.stringify(prompt);
    let response = "mock response";

    // Eval judge style calls expect JSON back
    if (config.responseMimeType === "application/json" || config.responseSchema) {
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
        yield { text: word + " " };
    }
}

module.exports = { embed, generate, generateStream };
