/**
 * utils/queryRewrite.js — condense a context-dependent follow-up into a
 * standalone retrieval query (Phase 4.4). RAG_REWRITE=true enables it
 * (default per the measured trade-off in DECISIONS.md).
 *
 * Only the RETRIEVAL query is rewritten — the stored user message is
 * untouched. History is untrusted data wrapped in <chat_history> tags.
 * Any failure falls back to the original message.
 */
const geminiHelper = require("./geminiHelper");
const guard = require("./guard");
const logger = require("./logger");

// Context-dependence heuristic: short message, pronouns/deictics, or no
// capitalized named entity. Cheap pre-filter so rewrite calls are rare.
const PRONOUN_RE = /\b(it|that|this|those|these|they|them|its|their|his|her|he|she|the above|the same|what about|how about|and what|also|more|again|another)\b/i;

function looksContextDependent(message) {
    const m = message.trim();
    if (m.length > 140) return false;
    const words = m.split(/\s+/).length;
    if (PRONOUN_RE.test(m)) return true;
    // A capitalized token after the first word ⇒ likely a named entity ⇒
    // the question stands alone.
    const hasEntity = /\s[A-Z][a-z]/.test(m);
    return !hasEntity && words <= 15;
}

const REWRITE_SCHEMA = {
    type: "object",
    properties: {
        needsRewrite: { type: "boolean" },
        standalone: { type: "string", description: "the self-contained retrieval query" },
    },
    required: ["needsRewrite", "standalone"],
};

const MAX_HISTORY_CHARS = 300;

/**
 * @param {string} message - current user message (already trimmed)
 * @param {Array}  history - [{role:"user"|"model", content}] most-recent-first irrelevant
 * @returns {Promise<{query:string, rewritten:boolean}>}
 */
async function maybeRewriteQuery(message, history) {
    // Default ON: the gold-standalone ceiling lifts follow-up MRR 0.40→1.00
    // (overall 0.8725→0.9625, nothing else regresses) and failures fall back
    // to the original query. RAG_REWRITE=false disables.
    if (process.env.RAG_REWRITE === "false") return { query: message, rewritten: false };
    if (!Array.isArray(history) || !history.length) return { query: message, rewritten: false };
    if (!looksContextDependent(message)) return { query: message, rewritten: false };

    // History text is DATA — wrapped + neutralized like retrieved sources.
    const tail = history.slice(-4).map((h) =>
        `<chat_history role="${h.role === "user" ? "user" : "model"}">${guard.neutralize(String(h.content || "").slice(0, MAX_HISTORY_CHARS))}</chat_history>`
    );
    const prompt =
        `Decide whether the latest user message needs conversation context to be understood. ` +
        `If yes, rewrite it as one self-contained search query. If it is already standalone, set needsRewrite=false.\n\n` +
        `${tail.join("\n")}\n<chat_history role="user">${guard.neutralize(message.slice(0, MAX_HISTORY_CHARS))}</chat_history>\n\nJSON:`;

    try {
        const res = await geminiHelper.generateCheapest(
            prompt,
            { responseMimeType: "application/json", responseSchema: REWRITE_SCHEMA },
            "chat"
        );
        const text = geminiHelper.getText(res);
        const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || text);
        if (parsed?.needsRewrite === true && typeof parsed.standalone === "string" && parsed.standalone.trim()) {
            const standalone = parsed.standalone.trim().slice(0, 500);
            if (standalone.toLowerCase() !== message.toLowerCase()) {
                return { query: standalone, rewritten: true };
            }
        }
        return { query: message, rewritten: false };
    } catch (e) {
        logger.warn({ err: e.message }, "[rewrite] failed — using original query");
        return { query: message, rewritten: false };
    }
}

module.exports = { maybeRewriteQuery, looksContextDependent };
