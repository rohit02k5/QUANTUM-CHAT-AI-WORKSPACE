/**
 * gen-landing-metrics.js — exports committed eval numbers into
 * client/src/landingMetrics.json so the public landing page renders REAL,
 * committed-report-backed metrics at build time (Phase 6.5 honesty rule).
 *
 *   node scripts/gen-landing-metrics.js
 *
 * Sources: evals/baseline.json (production-default answer chain),
 *          evals/retrieval-baseline.json, evals/retrieval-hard-results.json.
 * The output is committed — rerun after a verified eval refresh.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));

const baseline = read("evals/baseline.json");
const retrieval = read("evals/retrieval-baseline.json");
let hard = null;
try { hard = read("evals/retrieval-hard-results.json"); } catch { /* optional */ }

const m = baseline.metrics || {};
const pct = (x) => Math.round(x * 1000) / 10;

const out = {
    generatedAt: new Date().toISOString(),
    sources: {
        answer: { file: "evals/baseline.json", runAt: baseline.timestamp, provider: baseline.provider || "gemini", model: baseline.answerModel || "gemini-2.5-flash" },
        retrieval: { file: "evals/retrieval-baseline.json", runAt: retrieval.timestamp, mode: retrieval.mode },
        hard: hard ? { file: "evals/retrieval-hard-results.json", runAt: hard.runAt } : null,
    },
    quality: {
        faithfulness: pct(m.faithfulness),
        relevance: pct(m.relevance),
        factCoverage: pct(m.factCoverage),
        hitAtK: pct(m.hitAtK),
        mrr: pct(m.mrr),
        abstentionAccuracy: pct(m.abstentionAccuracy),
        injectionSafety: pct(m.injectionSafe),
        timestampCitationAccuracy: pct(m.timestampCitationAccuracy),
        pageCitationAccuracy: pct(m.pageCitationAccuracy),
        imageQAAccuracy: pct(m.imageQAAccuracy),
        tableQueryAccuracy: pct(m.tableQueryAccuracy),
        meanLatencyMs: m.meanLatencyMs,
        agent: m.agent ? {
            toolSelectionAccuracy: pct(m.agent.toolSelectionAccuracy),
            contentAccuracy: pct(m.agent.contentAccuracy),
            abstentionAccuracy: pct(m.agent.abstentionAccuracy),
            injectionSafety: pct(m.agent.injectionSafety ?? m.agent.injectionSafe),
            avgSteps: m.agent.avgSteps,
        } : null,
        retrieval: retrieval.overall ? { hitAt1: pct(retrieval.overall.hitAt1), mrr: pct(retrieval.overall.mrr), n: retrieval.overall.n } : null,
        retrievalHard: hard ? {
            vectorMrr: pct(hard.modes.vector.mrr),
            hybridMrr: pct(hard.modes.hybrid.mrr),
            diffs: hard.perQueryDiffsHybridVsVector,
        } : null,
    },
};

const dst = path.join(root, "client/src/landingMetrics.json");
fs.writeFileSync(dst, JSON.stringify(out, null, 2) + "\n");
console.log("[gen-landing-metrics] wrote", dst);
