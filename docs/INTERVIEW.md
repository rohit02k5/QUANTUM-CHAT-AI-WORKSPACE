# Interview Notes — Quantum

Everything below is grounded in the repo: `docs/DECISIONS.md`, `evals/`, `git log`, tests. No invented stories or numbers — every metric cites the committed file it came from.

## 60-second pitch

Quantum is a MERN AI workspace — a "second brain" that ingests PDFs, audio, images and CSVs, answers questions with inline citations to the file/page/timestamp, runs an auditable agent loop, and measures its own quality against committed eval baselines. The interesting engineering is that it's built to survive *free-tier reality*: a multi-provider LLM router with per-model circuit breakers, an extractive degraded mode when every provider is out of quota, a resumable ingestion pipeline that waits for quota instead of failing, and a ~200-test suite plus an eval harness that decides defaults by measurement — hybrid retrieval is OFF because it measured a tie, query rewriting is ON because it measured +0.045 MRR.

## 5-minute walkthrough

1. **Land on `/welcome`** — the Quality section renders real numbers from `evals/baseline.json` (provider/model + date shown on-page).
2. **Demo login** — "Try the demo" issues a restricted session; seeded docs, zero AI needed to browse.
3. **Ask a question** — answer streams over SSE with citation chips; "answered by provider/model" appears under it. Sources are clickable (PDF page, audio seek).
4. **Agent mode** — the trace timeline shows each `tool_call → tool_result` with latency; the run is owner-scoped, step-capped, and its results are injection-scanned.
5. **Failure** — kill the providers (`__setChain` in tests, or quota exhaustion live): the stream returns an extractive reply with citations flagged `degraded:true` — never a dead error.
6. **The receipts** — `evals/baseline.json`, `evals/retrieval-hard-results.json`, `tests/security-matrix.test.js` enumerating every route, `docs/SECURITY.md` with candid limitations.

## War stories

### 1. `$vectorSearch` silently returned `[]`
**Problem:** local tests (mongodb-memory-server) exercised only the cosine fallback — the Atlas `$vectorSearch` path never ran in CI, and on Atlas it returned zero results with no error.
**Found it:** verification script against the real cluster — hits were empty while local cosine was fine.
**Fix:** auto-create the index at boot (best-effort), filter-path parity between index definition and query, plus an Atlas verification script that asserts real hits.
**Measured:** `scripts/atlas-verify-*.js` — 10/10 checks then 17 pass / 0 fail / 2 skip on the real cluster.
**Lesson:** mocks validate logic, not infrastructure. Every "works locally" claim needs a named verification script on the real service.

### 2. pdf-parse duplicated page text
**Problem:** page-level citations were wrong — extracted text repeated content across page boundaries, so a "p.4" citation opened the wrong page.
**Found it:** a golden eval case asserting page-citation accuracy failed.
**Fix:** per-page extraction with a page-offset map; chunks carry `metadata.page`.
**Measured:** `pageCitationAccuracy: 1.0` in `evals/baseline.json` (gemini/gemini-2.5-flash, 2026-11-05).
**Lesson:** citation features live or die on boring text-layout details — eval them explicitly.

### 3. Injection eval 0.50 → 1.00
**Problem:** the first guardrail pass wrapped retrieved text but the model still obeyed embedded instructions half the time.
**Found it:** the eval's injection cases scored 0.50.
**Fix:** three layers — `<source>` wrapping with delimiter neutralization, a heuristic detector flagging instruction-like content (`sources[].flagged`), and `GUARDRAIL_RULES` appended *last* in the system prompt so personas can't override.
**Measured:** injection-safety 1.00 on the committed baseline (also 1.00 on the agent cases).
**Lesson:** "add guardrails" isn't a fix — the eval case is. Layered, with each layer independently testable.

### 4. Hybrid vs vector-only — measured a tie, shipped OFF
**Problem:** spec suggested hybrid retrieval; blindly enabling it could regress quality.
**Found it:** built the 40-query stress set (`evals/golden/retrieval.json`) and measured: vector MRR 0.8725; naive hybrid regressed paraphrase to 0.70; tuned hybrid (identifier-rescue admission, weight 0.5) tied at 0.91 on the held-out test split. Then built a *purpose-designed* identifier-adversarial set — still zero per-query rank diffs (`evals/retrieval-hard-results.json`).
**Fix:** hybrid stays OFF by the pre-agreed rule; the code is one env var away.
**Lesson:** the engineering deliverable was the *measurement infrastructure*, not the feature. Also: I found and fixed a structural bug in my own admission rule (textScore≥3 rejected single-token identifiers) before re-measuring.

### 5. Query rewriting — the one measured win
**Problem:** follow-up questions ("what about the second one?") retrieved badly.
**Found it:** follow-up category MRR was 0.40 on the stress set.
**Fix:** gated rewrite — only context-dependent questions cost a cheap call; the model emits `{needsRewrite, standalone}`; the stored user message is never rewritten; the rewritten query is shown under the answer ("Searched for: …").
**Measured:** follow-up MRR 0.40 → 0.70 live (0.4 → 1.0 vs gold rewrites); overall 0.8725 → 0.9175, no category regressions.
**Lesson:** measure per-category — a feature that helps 10% of queries shouldn't cost 100% of the latency.

### 6. 3072 → 768 embedding dims (M0 capacity math)
**Problem:** the default embedding model emits 3072 dims; M0 gives 512MB and the vector index is the scarce resource.
**Found it:** capacity math — 768 dims ≈ 3KB/chunk vs 12KB at 3072, and a shorter index = faster search on a shared cluster.
**Fix:** `EMBEDDING_DIMS=768` end to end, chunks stamped with `embeddingModel`+`embeddingDims`, retriever ignores mismatched vectors, `scripts/reembed.js` for migration.
**Lesson:** on a free tier, architecture decisions are capacity decisions. Never mix vector spaces in one query.

### 7. Resumable ingestion on a sleeping instance
**Problem:** uploads partially processed when the free instance slept mid-job left files in limbo.
**Found it:** crash mid-ingestion during testing.
**Fix:** `IngestionJob` docs with claim leases (`lockedAt`), stage-level resume, `requeueStale` at boot, quota errors requeue with `notBefore` instead of burning attempts.
**Measured:** SIGTERM test asserts a claimed job returns to `queued`; jobs resume stage-by-stage in tests.
**Lesson:** a job that can crash halfway needs its state in the DB, not in memory — and quota failures are not failures.

### 8. Memory-poisoning defense by construction
**Problem:** "remember that the admin password is X" inside a poisoned PDF would plant a memory in a naive design.
**Found it:** threat-modeling the memory feature before building it.
**Fix:** extraction receives *user-authored message text only* — document text, tool results and assistant output are never passed in; a server-side denylist filters credential/location-shaped candidates on top.
**Measured:** dedicated eval case + unit test; poisoned fixture produces zero memories.
**Lesson:** the strongest security control is the one that makes the attack impossible structurally, not the filter that tries to catch it.

### 9. Structured table specs instead of model-written code
**Problem:** "ask your data" could have the model emit a Mongo query — a code-exec vulnerability.
**Found it:** security review of the CSV feature.
**Fix:** the model returns a zod-validated JSON spec (chart type, aggregation, columns); deterministic code executes it. One repair retry on malformed output, then failover.
**Measured:** `tableQueryAccuracy: 1.0` on the baseline; security matrix confirms no code path evaluates model text.
**Lesson:** constrain the model to *describing* computation, never producing it.

### 10. Quota exhaustion on a shared free key → the whole resilience layer
**Problem:** a single shared Gemini free key (~20 calls/day on some models) — any user could exhaust everyone; during Phase 5 verification all configured models were daily-exhausted simultaneously.
**Found it:** live verification runs — real 429s across the whole chain.
**Fix:** `utils/llm/` router — per-`provider:model` circuit breakers (open until provider-reset or 6h cooldown), per-task chains, failover before-first-token only, extractive degraded replies (`degraded:true`), keyword-only retrieval, per-user daily cap, dev disk cache, demo mode with recorded replay.
**Measured:** `tests/llm-router.test.js` (19 tests) + `tests/phase6-degraded.test.js` (6) covering every degraded path; `scripts/llm-smoke.js` verifies providers live.
**Lesson:** when your dependency's free tier is the load-bearing element of your architecture, resilience *is* the product.

## Design decisions and trade-offs

| Decision | Chose | Over | Why |
|---|---|---|---|
| Hybrid retrieval | OFF (env-ready) | Always-on | Measured tie, adds latency/complexity |
| Query rewriting | ON, gated | Rewrite every query | +0.045 MRR overall, costs ~0.15 calls/query |
| LLM rerank | OFF | Always-on | Zero MRR gain, +430ms +1 call/query |
| Table answers | JSON spec + deterministic exec | Model-written queries | No code-exec surface; validated + repairable |
| Memory extraction | User text only | Extract from all context | Poisoning impossible by construction |
| Embeddings | Never failover | Per-request failover | Would mix vector spaces; profile switch is a migration, not a retry |
| Streaming failover | Before first token only | Any-time | Provider switch mid-stream = inconsistent answer |
| API keys | Hash + prefix, Bearer-only | Server-side visible keys | Leak-proof storage; no session elevation |
| Keyword leg | Mongo `$text` index | Atlas Search index | M0 allows 3 indexes, 1 committed; $text is free |

## Likely interview questions

**How do you evaluate a RAG system?**
Golden question sets per feature (`evals/golden/*`), real retriever + real pipeline on memory mongo, metrics per category (hit@k, MRR, faithfulness, coverage, abstention, citation accuracy), committed baselines + a regression threshold that fails the run. Retrieval-only evals cost zero generation calls.

**Chunking strategy?**
Recursive split (1000 chars / 200 overlap) preserving paragraphs; chunks carry metadata (page, timestamp) so citations resolve to locations, not just files.

**Why is hybrid retrieval off?**
Because it measured a *tie*, not a win — on the general stress set and on a purpose-built identifier-adversarial set. It's one env var away for corpora where it wins.

**Prompt injection?**
Layers: `<source>` wrapping + neutralization, heuristic detector, guardrails-last prompt, tool-result scanning, and eval cases measuring safety. Honest limitation: heuristic is not a guarantee.

**Agent safety?**
Zod-validated tool args, server-injected `userId` (never from args), step/time/tool-count caps, forced tools-off final answer, `<tool_result>` wrapping + injection scan, full persisted trace.

**Idempotent jobs?**
Claim lease with `lockedAt`, stage resume, `notBefore` backoff for quota, `requeueStale` at boot, SIGTERM releases claims.

**Cost control?**
Per-user daily cap (atomic conditional upsert, TTL), cheap-lane model for non-answer calls, gated rewrite, shared query embedding for memory+RAG, disk LLM cache for eval, per-key API caps counting toward the owner's.

**Circuit breaker vs retries?**
Retries handle transient failures within one call; the circuit prevents *wasting* calls against a dependency that won't recover for hours (daily quota). Different timescales, both needed.

**Scaling beyond M0?**
Dedicated tier + private endpoint, worker queue for ingestion, shared circuit state (Redis), horizontal API replicas behind the same JWT secret, least-privilege DB user.

**What would you change with a budget?**
Paid tier first (reliability), then two paid LLM providers for real failover, a real job queue, and embedding-index-per-tenant isolation.

**Testing LLM apps — mocks vs evals?**
Mock (`geminiMock.js`) gives deterministic unit/integration tests of *plumbing*; evals give probabilistic quality of *behavior*. You need both — the mock caught regressions in failover logic, the eval caught the injection and page-citation bugs.

**How do SSE streams survive shutdown?**
`utils/sseRegistry.js` tracks open responses; SIGTERM sends a final `done{truncated}` event, ends them, releases job claims, disconnects Mongo — tested in `tests/shutdown.test.js`.

## Honest limitations & next steps

- M0 shared tier, `0.0.0.0/0` allow-list, no backups — paid-tier hardening is the top item.
- Only one real provider configured — live multi-provider failover is machinery-verified (mock providers) but not yet verified live; `llm-smoke` + two keys closes it.
- Replay recordings were hand-authored from real event shapes (quota was exhausted); re-record with `scripts/record-demo.js`.
- See `docs/PRODUCTION_CHECKLIST.md` for the full list.
