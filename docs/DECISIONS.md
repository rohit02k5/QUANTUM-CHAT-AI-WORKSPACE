# Design Decisions

One short entry per phase: what was built, why, tradeoffs, and free-tier implications.

---

## Phase 0 — Foundations / Trust Layer

**Goal:** before adding features, make the system measurable, testable, and honest about quality.

### Tests (Vitest + Supertest + MongoDB Memory Server)
- `tests/` covers auth (register/refresh/reject), ownership isolation across chats/files/chunks/file-streaming, chunker behavior, retriever cosine fallback, and `/health`.
- `utils/geminiMock.js` is a deterministic mock (seeded embeddings with controlled similarity, canned generation) enabled via `GEMINI_MOCK=1`. Tests run fully offline — no Gemini key, no Atlas needed.
- `app.js` was extracted from `server.js` so tests can mount the real Express app without binding a port. `server.js` now only does bootstrap concerns (connect, index creation, sweep, listen).
- **Tradeoff:** mongodb-memory-server cannot run `$vectorSearch`, so the Atlas leg is exercised only via the fallback path in tests. Real-Atlas verification is covered by `/health`'s `vectorIndex` probe and manual smoke tests.
- **Free-tier:** CI runs entirely on GitHub Actions free minutes with zero external secrets.

### Observability (pino + request IDs + UsageEvent)
- `utils/logger.js` — pino, pretty in dev / JSON in prod. `middlewares/requestId.js` generates/propagates `x-request-id`; `utils/requestContext.js` stores it in AsyncLocalStorage so every log and UsageEvent can carry `requestId` without plumbing.
- `GET /health` reports `{status, uptimeSec, version, db:{ok,latencyMs}, vectorIndex, models}` and returns 503 when the DB is down — cheap enough for Render's health checks.
- `models/UsageEvent.js` records every Gemini call (kind, model, tokens from `usageMetadata`, latency, ok, requestId) — **fire-and-forget**, so a logging failure can never break a user request. TTL index expires events after 90 days.
- `GET /api/v1/usage/me` aggregates the last 30 days (totals, p50/p95, daily series); `GET /api/v1/usage/admin` is gated by `ADMIN_EMAILS`. Dashboard shows a compact usage panel.
- **Tradeoff:** fire-and-forget means a crash between the API call and the insert can drop one event — acceptable for usage analytics, not for billing.
- **Note:** prompt/document text is never logged — only counts and metadata.

### Gemini SDK migration (`@google/generative-ai` → `@google/genai`)
- The legacy SDK is deprecated; all calls now go through `@google/genai`, confined to `utils/geminiHelper.js`. No other file imports the SDK.
- Behavior preserved: model fallback chain, bounded retries with exponential backoff on 429/5xx, `getText()` extraction.
- New: per-call `task` typing (`chat`, `embed:document`, `embed:query`, `judge`…), `usageMetadata` capture, and the mock injection seam used by tests.
- **Free-tier:** fallbacks ordered cheapest-first (`flash` → `flash-lite`); the 429 retry policy stays conservative to avoid compounding quota burn.

### Embedding dimensions (768, configurable)
- `EMBEDDING_DIMS` (default 768) is passed via the SDK's `outputDimensionality`; vectors are L2-normalized when the API doesn't. Task types `RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY` are used per call side.
- `Chunk` stores `embeddingModel` + `embeddingDims`; the retriever silently ignores chunks whose dims/model don't match the active config instead of crashing on dimension mismatches.
- **Why 768:** the old code assumed 3072. A live check under `@google/genai` returned 768-dim normalized vectors for `gemini-embedding-2`, so dims are now config-driven rather than hardcoded — any future model change only needs an env update + `scripts/reembed.js`.
- `scripts/reembed.js` re-embeds existing chunks in batches — resumable (skips chunks already at target dims), idempotent, `--dry-run` for preview. **Old vectors are never deleted automatically.**
- **Migration cost:** re-embedding N chunks costs N embedding calls. On the free tier that's slow but safe; the script batches with concurrency 5.

### Eval harness (`scripts/eval.js`)
- `evals/fixtures/` has 4 self-written docs (product spec, Apollo history, meeting notes, and a **poisoned cafeteria menu** containing a prompt-injection payload).
- `evals/golden/questions.json` — 22 questions: factual, multi-fact, unanswerable (correct = abstain), and injection cases (correct = ignore the embedded instruction).
- Metrics per run: hit@k, MRR, faithfulness (LLM-as-judge on the answer vs retrieved context), relevance, fact coverage, abstention accuracy, injection-safety, mean latency. One judge call per question keeps runs under `EVAL_MAX_CALLS`.
- Reports land in `evals/reports/<ts>.{json,md}`; `evals/baseline.json` gates regressions (exit 1 if any metric drops > `EVAL_REGRESSION_THRESHOLD`, default 10%).
- `--memory` runs the whole pipeline on mongodb-memory-server (no Atlas needed); `--reingest` forces re-embedding.
- **Design choice:** the judge is a single structured-output call producing all per-answer metrics — 2 calls/question keeps a full run under the free-tier daily quota (~150 calls).
- **Note on pacing:** `EVAL_PACE_MS` spaces questions because free-tier RPM is easy to exhaust mid-run; a question-level failure is recorded, never fatal.

### Deviations from the original spec
- Route prefix stays `/api/v1/...` (repo convention), not `/api/...`.
- The dashboard usage panel lives on `Homepage.js` and renders only when data exists.
- `node` version in CI is 24 to match production.
