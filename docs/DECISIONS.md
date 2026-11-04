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

---

## Phase 1 — Streaming Chat + Guardrails + Chat QoL

**Goal:** token-by-token answers, and sources that can't hijack the model.

### SSE streaming (`POST /api/v1/chat/:chatId/stream`)
- `:chatId` may be `"new"` — a fresh chat is created then (the spec only
  defined the existing-chat case; sendMessage already accepted an optional
  chatId, so this keeps both paths symmetric).
- Events are single-line JSON: `data: {"type":"meta|token|done|error", ...}`.
  Chosen over named `event:` fields because the client parses each `data:`
  block uniformly — same information, simpler code.
- `meta` (sources + requestId + chatId) goes out before the first token so
  the UI can show citations immediately; `: ping` every 15s defeats idle
  timeouts on Render's proxy.
- **Client disconnect** is detected via `res` "close" (more reliable than
  `req` "close" once a response is streaming), the upstream call is aborted
  via AbortSignal, and the partial answer is persisted with
  `truncated: true` — reload shows exactly what the user saw, marked
  "partial answer".
- **Model fallback on stream:** the helper pulls the *first* chunk eagerly —
  a model is only skipped when it fails before producing anything, so a
  mid-stream failure is never silently duplicated by retrying on another
  model.
- Non-stream `POST /message` is untouched and is the client's automatic
  fallback when the stream can't start (network, old server, etc.).
- Shared context prep (retrieval, attachment excerpt, persona, system
  instruction) is one function used by both endpoints — the two paths
  cannot drift.
- **Tradeoff:** streaming bypasses express's JSON path entirely; there's no
  compression middleware in the app, so nothing needed disabling.
- **Free-tier:** SSE on Render works fine; heartbeats + `X-Accel-Buffering:
  no` are the only infra needs. No Redis, no workers.

### Prompt-injection guardrails (`utils/guard.js`)
- Every retrieved chunk and attachment is wrapped in
  `<source id file page>` tags; delimiter-like sequences *inside* the text
  (`</source>`, `[SYSTEM...`, `=== BANNER ===`, im_start tags) are
  neutralized before wrapping, so injected content can't escape its cell.
- A heuristic detector (~15 regexes: instruction-override phrases, fake
  system/admin markers, role-switch, exfiltration) **flags** a chunk but
  never drops it — flagged sources are still data and render with a small
  warning marker on the citation chip. Silent dropping would hide evidence
  and break "why did it say that" debugging.
- `GUARDRAIL_RULES` is always the **last** block of the system instruction
  (persona text prepends before it) — later instructions win, so this makes
  guardrails structurally authoritative. Adversarial personas cannot
  reorder them.
- Same wrapper used in the non-stream path, the stream path, and the eval
  script — the eval measures what users actually get.
- **Measured result:** injection-safe went 0.50 → see `evals/baseline.json`
  (the Phase 0 baseline had the model echoing an injected fake "system
  notice" when asked for its prompt).

### Chat QoL
- **Auto-title:** after the first exchange, a fire-and-forget call on the
  *cheapest* configured model rewrites the truncated-message title. If it
  fails, the truncated title stays — zero cost, zero latency impact.
- `Chat` gained `pinned`, `tags`, `personaKey`/`personaId`;
  `PATCH /api/v1/chat/:id` validates and is owner-scoped. `getUserChats`
  sorts pinned-first (additive).
- **Personas:** presets in `config/personas.js` + `Persona` model
  (name, systemPrompt ≤2000 chars, per-user unique name, 20/user cap).
  `GET/POST/PATCH/DELETE /api/v1/personas`; deleting a persona detaches it
  from chats.
- Sidebar: pinned section + tag-filter chips; header: inline title edit +
  pin; composer: persona Select; source chips show `flagged` warning.

### Deviations from spec
- Stream endpoint is `/api/v1/chat/:chatId/stream` (`/api/v1` convention);
  `:chatId = "new"` starts a fresh chat.
- Rate-limit test uses `TEST_RATE_LIMIT=1` + `AI_RATE_MAX` env knobs rather
  than firing 101 requests in CI.
- `res` "close" (not `req`) drives the abort path — verified by a real
  socket test that destroys the connection mid-stream.
- No persona create/edit UI — the composer picker covers selection; CRUD is
  API-complete and documented.

## Phase 2 — Agent Mode (tools, trace, browse)

- **Same endpoint, same plumbing.** `mode:"agent"` on
  `POST /api/v1/chat/:chatId/stream` reuses the Phase 1 SSE machinery —
  heartbeats, `res` close → AbortSignal, truncated-partial persistence,
  UsageEvent logging, and the AI rate limiter (one agent request = one
  request, regardless of internal steps). Non-agent behavior is untouched.
- **Loop** (`services/agent.js`): `generateAgentTurn` (non-streaming
  `generateContent` with `functionDeclarations`) → execute declared tools
  server-side → feed `functionResponse` parts back → repeat until plain text
  or a limit (`AGENT_MAX_STEPS`, `AGENT_TIMEOUT_MS`, `AGENT_MAX_TOOLS_PER_STEP`
  — all read per-call from env). Any limit forces one tools-off final answer;
  its text is chunked into `token` events so the client contract is identical.
- **Tool registry** (`tools/index.js`): `{name, description,
  parameters(JSON Schema), schema(zod), handler(ctx,args)}`. `ctx =
  {userId, chatId, requestId, signal}` is server-injected — `userId` can
  never come from the client or model args. Unknown tools / invalid args /
  disabled tools (`web_search` with `browse=false`) all return *error tool
  results* — nothing throws inside the loop.
- **Guardrails apply to tools too.** Every tool result is JSON-wrapped in a
  `<tool_result>` element, delimiter-neutralized and injection-scanned via
  `guard.js`; flagged results are still passed as data and surface as
  `flagged` citation chips.
- **No raw document text in the wire trace.** SSE `tool_call`/`tool_result`
  events carry `argsPreview`/`summary` truncated ≤200 chars of *metadata*
  (query strings, counts) — never chunk text. The persisted `message.trace`
  is the same shape.
- **web_search is a separate model call** (`tools:[{googleSearch:{}}]`) —
  Gemini forbids combining grounding with function declarations in one
  request. Quota: `WebSearchQuota` counter doc per user+UTC-day, `count`
  incremented before the call, TTL-expired at midnight; over-cap returns a
  clear error result. UsageEvent kind `"tool"`.
- **Ownership inside tools** is enforced with the same pattern as the rest
  of the app: `File.findOne({_id, user: ctx.userId})`; `search_knowledge_base`
  silently drops `fileIds` the caller doesn't own rather than erroring.
- **New models (additive):** `FlashcardSet` (the studio flashcards endpoint
  returned ephemeral cards — this is the first persistent deck storage;
  Phase 5 may migrate it), `WebSearchQuota`, `File.overview` (lazy cached
  summary), `Chat.messages[].trace` + web-source fields on `sources[]`.
- **UI:** composer mode Select (Chat/Agent) + Browse checkbox (agent only,
  hidden entirely when `FEATURE_AGENT=off` via `GET /api/v1/features`);
  collapsible "How I got this answer" timeline under agent messages (live
  during streaming, persisted after); web sources as domain chips.
- **CI stability (2.0):** `MONGOMS_VERSION` pinned, binary cached via
  `actions/cache` at `.cache/mongodb-binaries`, 60s startup timeout, one
  retry in `tests/setup.js`.
- **Eval:** `evals/golden-agent.json` — 10 cases scored on tool selection,
  min tool calls, content, abstention, and a poisoned tool result; agent
  metrics are nested under `metrics.agent` and regression-gated (except
  `avgSteps`). Agent model calls are approximately counted against
  `EVAL_MAX_CALLS`.

### Deviations from spec
- Agent tool calls run through the **non-streaming** model API
  (`generateAgentTurn`) and the final answer is emitted as `token` events —
  the client sees an identical SSE stream, but intermediate-step model text
  is not streamed (it is discarded, per spec).
- `analyze_table` intentionally returns `{ok:false}` — stub per spec.
- Flashcard persistence uses a new `FlashcardSet` model — the pre-existing
  endpoint only produced ephemeral cards; spec deferred real storage to
  Phase 5.
