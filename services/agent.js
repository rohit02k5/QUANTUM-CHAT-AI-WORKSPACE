/**
 * services/agent.js — agentic loop over Gemini function calling.
 *
 * model -> function calls -> execute server-side (owner-scoped ctx) ->
 * feed results back -> repeat until a plain-text answer or a limit.
 * Limits: AGENT_MAX_STEPS, AGENT_TIMEOUT_MS, AGENT_MAX_TOOLS_PER_STEP.
 * On any limit, force one final answer with tools disabled.
 *
 * Emits SSE-shaped objects via `emit` ({type:"tool_call"|"tool_result"}).
 * Never throws — the caller decides how to report failures.
 */
const geminiHelper = require("../utils/geminiHelper");
const tools = require("../tools");
const guard = require("../utils/guard");
const logger = require("../utils/logger");
const { getRequestId } = require("../utils/requestContext");

// Env caps are read per-call (tests can vary them; ops can tune without rebuild)
const MAX_STEPS = () => parseInt(process.env.AGENT_MAX_STEPS || "5", 10);
const TIMEOUT_MS = () => parseInt(process.env.AGENT_TIMEOUT_MS || "45000", 10);
const MAX_TOOLS_PER_STEP = () => parseInt(process.env.AGENT_MAX_TOOLS_PER_STEP || "3", 10);

const AGENT_RULES = [
    "",
    "AGENT BEHAVIOR:",
    "5. You may call the provided tools to gather information. Prefer the knowledge base for questions about the user's documents.",
    "6. After gathering enough context, answer directly without calling tools. Cite knowledge-base sources by their id.",
    "7. If tools return errors or insufficient data, say so plainly instead of guessing.",
].join("\n");

const host = (uri) => {
    try { return new URL(uri).hostname.replace(/^www\./, ""); } catch { return uri; }
};

/**
 * @returns {Promise<{text, trace, sources, webSources, usage, stepsUsed, forced}>}
 */
async function runAgent({ userId, chatId, message, history, personaPrompt, memoryBlock, browse, emit, signal }) {
    const deadline = Date.now() + TIMEOUT_MS();
    const trace = [];
    const sources = [];
    const webSources = [];
    const seenChunks = new Set();
    let usage = null;
    let stepsUsed = 0;
    let forced = false;

    // First turn carries the flat history transcript + the user message
    const historyText = (history || [])
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.parts?.[0]?.text || ""}`)
        .join("\n");
    const firstText = historyText ? `${historyText}\n\nUser: ${message}` : `User: ${message}`;
    const contents = [{ role: "user", parts: [{ text: firstText }] }];

    const systemInstruction = guard.buildSystemInstruction({ personaPrompt, memoryBlock }) + "\n" + AGENT_RULES;
    const declarations = tools.declarations({ browse });
    const available = new Set(declarations.map((d) => d.name)); // server-side gate — browse=false blocks web_search even if the model asks
    const ctx = { userId, chatId, requestId: getRequestId(), signal };

    const exhausted = () => signal?.aborted || Date.now() >= deadline;

    const forceFinalAnswer = async () => {
        forced = true;
        const res = await geminiHelper.generateAgentTurn(contents, { systemInstruction }, signal);
        usage = geminiHelper.getUsageMetadata(res) || usage;
        return geminiHelper.getText(res) || "I was unable to produce an answer within the step budget.";
    };

    for (let step = 1; step <= MAX_STEPS(); step++) {
        if (exhausted()) break;
        stepsUsed = step;

        const res = await geminiHelper.generateAgentTurn(
            contents,
            { tools: [{ functionDeclarations: declarations }], systemInstruction },
            signal
        );
        usage = geminiHelper.getUsageMetadata(res) || usage;

        const calls = geminiHelper.getFunctionCalls(res).slice(0, MAX_TOOLS_PER_STEP());
        if (!calls.length) {
            return { text: geminiHelper.getText(res), trace, sources, webSources, usage, stepsUsed, forced };
        }

        // Feed the model's turn back verbatim so tool-call pairing stays intact
        contents.push({ role: "model", parts: geminiHelper.getResponseParts(res) });

        const responseParts = [];
        for (const call of calls) {
            if (exhausted()) break;
            const callId = `${step}:${call.name}`;
            const argsPreview = tools.preview(call.args);
            emit({ type: "tool_call", id: callId, name: call.name, argsPreview });

            const t0 = Date.now();
            // Registered-but-disabled tools (e.g. web_search with browse=false)
            // are refused here; unknown names fall through to execute() which
            // returns its own "unknown tool" error result.
            const outcome = tools.registry[call.name] && !available.has(call.name)
                ? { ok: false, error: `tool "${call.name}" is not available in this mode` }
                : await tools.execute(call.name, call.args, { ...ctx });
            const ms = Date.now() - t0;
            const summary = outcome.ok
                ? summarize(call.name, outcome.raw)
                : `error: ${outcome.error}`;
            emit({ type: "tool_result", id: callId, ok: outcome.ok, summary, ms });
            trace.push({ step, tool: call.name, argsPreview, ok: outcome.ok, ms, summary: String(summary).slice(0, 200) });

            // Collect citation material
            if (call.name === "search_knowledge_base" && outcome.ok) {
                for (const c of outcome.raw?.chunks || []) {
                    const key = `${c.fileId}:${c.text?.slice(0, 60)}`;
                    if (seenChunks.has(key)) continue;
                    seenChunks.add(key);
                    sources.push({
                        fileId: c.fileId,
                        originalName: c.file,
                        type: c.type,
                        page: c.page,
                        startSec: c.startSec,
                        score: c.score,
                        snippet: (c.text || "").slice(0, 200),
                        flagged: c.flagged || outcome.flagged || undefined,
                    });
                }
            }
            if (call.name === "web_search" && outcome.ok) {
                for (const s of outcome.raw?.sources || []) {
                    webSources.push({ title: s.title, uri: s.uri, domain: host(s.uri) });
                }
            }
            if (outcome.flagged) {
                logger.warn({ tool: call.name, step }, "[agent] tool result contained instruction-like text");
            }

            responseParts.push({
                functionResponse: {
                    name: call.name,
                    response: outcome.ok
                        ? { ok: true, content: outcome.result }
                        : { ok: false, error: outcome.error || "tool failed" },
                },
            });
        }
        if (responseParts.length) contents.push({ role: "user", parts: responseParts });
        if (exhausted()) break;
    }

    const text = await forceFinalAnswer();
    return { text, trace, sources, webSources, usage, stepsUsed, forced: true };
}

/** One-line, trace-safe summary of a tool result (no raw document text). */
function summarize(name, raw) {
    if (!raw || typeof raw !== "object") return "done";
    if (name === "search_knowledge_base") return `${raw.count ?? 0} chunk(s) retrieved`;
    if (name === "list_documents") return `${raw.documents?.length ?? 0} document(s)`;
    if (name === "get_document_overview") return `overview of "${raw.name}"${raw.cached ? " (cached)" : ""}`;
    if (name === "create_flashcards") return `deck "${raw.name}" — ${raw.count} card(s)`;
    if (name === "web_search") return `answer + ${raw.sources?.length ?? 0} source(s) (${raw.quotaLeft ?? "?"} quota left)`;
    return "ok";
}

module.exports = { runAgent };
