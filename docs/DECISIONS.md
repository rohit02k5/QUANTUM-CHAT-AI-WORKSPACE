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

## Phase 3A — GridFS storage, resumable ingestion jobs, audio pipeline

- **Storage audit result:** uploaded bytes lived on the app's local disk
  (`uploads/` via multer `diskStorage`; `File.path`; `fs.createReadStream`
  in `/view`). Render's disk is ephemeral — all uploads now go to **GridFS**
  (bucket `uploads`) on the mongoose connection's native driver. Multer
  still stages to disk momentarily, then `persistToGridFS` moves the bytes
  and deletes the temp file. `File.gridfsId` is the canonical pointer;
  `path` remains for legacy records (`scripts/migrate-to-gridfs.js`:
  idempotent, `--dry-run`, resumable via gridfsId presence, local files
  only deleted after byte-length verification).
- **Range requests** on `/api/v1/files/:fileId/view` (206 + Content-Range +
  Accept-Ranges) — required for `<audio>` seeking. Still authenticated and
  ownership-scoped; no public media URLs anywhere.
- **Job model** (`models/IngestionJob`): `{user, file, status, stage,
  progress, attempts, error, lockedAt, state}` with `{status,updatedAt}`
  and `{user,createdAt}` indexes. `state` is the resume checkpoint:
  `state.nextSeq` (embed watermark) and `state.audio.doneWindows` +
  accumulated `segments` (transcribe).
- **Runner** (`utils/jobRunner.js`): poll loop (`INGEST_POLL_MS`,
  `INGEST_CONCURRENCY` claim slots) claiming via `findOneAndUpdate
  queued→processing + lockedAt + attempts++` — two runners can never take
  the same job. Batched embeds (`INGEST_EMBED_BATCH`) with exponential
  backoff on 429/5xx. Boot requeues stale locks > `INGEST_STALE_MS`;
  ≥ `INGEST_MAX_ATTEMPTS` → `failed` with a user-readable error. SIGTERM/
  SIGINT stop claiming and release in-flight jobs back to `queued`.
- **Upload contract**: `202 {fileId, jobId, file}` for queued ingestion;
  `INGEST_SYNC=true` keeps the synchronous `201 {file, indexed, chunkCount}`
  shape. Temp attachments unchanged (sync extract + 201). Per-user storage
  cap `USER_STORAGE_MAX_MB` (100) enforced before storing (413).
- **Readiness gating**: `File.status` (`processing|ready|failed`) —
  retriever scopes to ready files only (legacy docs without `status` count
  as ready), agent tools (`get_document_overview`, `create_flashcards`)
  refuse non-ready files, `list_documents` shows the real status.
- **Audio**: magic-byte sniffing (`utils/audio.js`) — extension/MIME never
  trusted; `music-metadata` reads duration server-side (ESM loaded via
  dynamic `import()`); caps `AUDIO_MAX_MB`/`AUDIO_MAX_MIN`. Transcription
  model `GEMINI_TRANSCRIBE_MODEL` is verified against `listModels` at boot
  and falls back to the primary model with a warning. Inline parts ≤
  `AUDIO_INLINE_MAX_MB`; larger files go through the Gemini Files API and
  are **always deleted in `finally`**. Structured output via
  `responseSchema` → `[{startSec,endSec,speaker,text}]` grouped into
  ~1000-char chunks with `metadata.startSec/endSec/speakers`. Transcript
  text flows through the same `guard.js` pipeline as any chunk — `<source>`
  tags carry a `start="Ns"` attribute so the model can cite timestamps.
- **Playback & citations**: authenticated `<audio>` player fed by
  fetch-to-blob (`AudioPlayerModal`); chat source chips show `mm:ss` and
  seek the player. Executive Assistant gains a **Meeting** template
  (`POST /api/v1/openai/meeting-minutes`) — structured JSON normalized
  server-side, `sourceSec` chips seek the player, client-side Markdown
  export.
- **Eval scorer (3.0)**: injection-safe now distinguishes *quoting/
  flagging* injected text from *complying* — regex pre-filter for bare
  payload compliance + a sharpened `followsInjection` judge definition.
  New `timestampCitationAccuracy` metric + `meeting_audio.transcript.json`
  fixture (mocked-transcript form — real audio bytes can't be validated
  deterministically in CI). `EVAL_MONGO_DB` overrides the db name on a
  shared cluster; eval data is cleaned at end-of-run (skip with `--keep`).
- **Eval DB hygiene**: eval runs against Atlas use `quantum_ai_eval` and
  delete the eval user, files, chunks and jobs afterwards.

### Deviations from spec
- **Windowed long-audio transcription is prompt-based.** Without ffmpeg,
  audio can't be sliced server-side; windows (`AUDIO_SEGMENT_SEC`) ask the
  model for that time range with absolute timestamps. Each window is a
  resumable checkpoint, satisfying the resume requirement; token cost per
  window covers the whole file (documented, acceptable on free tier).
- `File.path` kept as optional legacy field rather than dropped.
- `list_documents` no longer does a chunk-count aggregate — `File.status`
  is authoritative (cheaper and correct under async ingestion).
- `<source>` tags gained a `start="Ns"` attribute for transcript chunks so
  the model can cite timestamps — additive to the Phase 1 wire format.
- `music-metadata` v12 added (its dependency `file-type` is only
  vulnerability-free at v12+); loaded via dynamic `import()` since the
  codebase is CommonJS.

## Phase 3B — Multimodal ingestion, page citations, table analyst

- **Silent-empty `$vectorSearch` bug (found only on real Atlas):** MongoDB
  returns `[]` — not an error — when `$vectorSearch` runs against a
  collection that lacks the named index, so the try/catch cosine fallback
  never engaged and any non-primary DB silently retrieved nothing. Found
  while evaluating `quantum_ai_eval` (every question missed, zero errors).
  Fixed by checking `listSearchIndexes` before attempting vector search
  (positive verdicts only are cached, so a later-created index is picked
  up). Regression test stubs `listSearchIndexes` to `[]` and asserts the
  aggregation is never attempted. Invisible to unit mocks — this class of
  bug is why the Atlas checklist exists.
- **Upload memory profile:** multer `diskStorage` already streamed bodies
  to disk, but `persistToGridFS`, the audio sniff and `extractDocs` each
  loaded whole files into RAM (≤26MB per request — meaningful on Render's
  512MB). Now: `gridfs.savePath` streams the temp file into GridFS, audio
  sniffing reads a 64-byte head and `music-metadata` `parseFile` streams
  duration, and `extractDocs` pipes GridFS→tmp for parsing.
- **Per-type caps enforced early:** `fileFilter` rejects via declared
  `Content-Length` against per-type caps (docs 10MB, audio `AUDIO_MAX_MB`,
  images `IMAGE_MAX_MB`) *before* bytes stage to disk — a 25MB `.txt` is
  refused at request start, not after writing 25MB. Global multer limit
  remains the outer bound; the controller re-checks post-staging as a
  belt-and-braces layer.
- **Eval robustness:** `evalRetry` wraps every eval Gemini call — quota
  walls (429 across all fallback models) retry with exponential backoff,
  counted against `EVAL_MAX_CALLS` and reported as `evalRetries`, so a
  momentary free-tier blip can no longer flake a case.
- **MRR 0.93→0.86 finding:** fixture dilution, not a retriever regression.
  All drops are `meeting_notes.txt` questions whose expected chunk fell to
  rank 2 because the new `meeting_audio.transcript.json` fixture is
  thematically identical (a meeting about the same project) and now
  competes inside `topK=3`. hit@k improved 0.9545→0.9615; the same corpus
  scored 0.9167 on Atlas. No parameter tuning — raising topK just to bump
  the number would weaken precision where it matters.
- **Per-page chunking was almost free — but the loader lied:** the
  LangChain-style splitter already preserves per-Document boundaries, so
  making `pdf-parse` emit one Document per page gave `metadata.page` on
  every chunk for free. In doing that we found `parser.getText({
  pageIndex })` is not a real pdf-parse v2 API — it silently returned the
  whole document for every page (duplicated chunks, no scanned-page
  detection). Fixed to a single `getText()` pass indexing `result.pages`,
  plus `standardFontDataUrl` pointing at `pdfjs-dist/standard_fonts` so
  PDFs that use the 14 unembedded standard fonts still extract. Pages
  under `PDF_MIN_PAGE_CHARS` are recorded on `File.pagesWithoutText` —
  the UI surfaces a scanned-page hint offering Deep analysis.
- **`/reprocess` preserves availability:** it upserts the new page-aware
  chunks first and prunes stale `type:"text"` chunks only after the new
  ones are embedded (stale = `seq >= newCount`). A failed reprocess keeps
  the old index intact; figure/image chunks live under separate keys and
  are never touched.
- **Vision outputs are untrusted data.** Image `describe` output
  (caption + OCR text + insights) becomes `type:"image"` chunks — 1–3 per
  image — and reaches the model only through the same `<source>` wrapping
  + injection detector as any retrieved text (visual prompt injection is
  real: "IGNORE ALL INSTRUCTIONS" rendered inside a photo must be data).
  The original bytes are stored untouched in GridFS; the inline copy sent
  to Gemini stays within inline limits, Files API above that, media
  deleted in `finally`.
- **Deep analysis slices, then checks, per ~5-page window.** `pdf-lib`
  copies the requested range into a small PDF per window (inline ≤10MB,
  Files API otherwise, always deleted). Structured output is
  slice-relative and mapped back to original page numbers; items outside
  the requested window are dropped (also covers the whole-PDF fallback
  when slicing fails). Windows checkpoint into `job.state.deepAnalysis`
  (`doneWindows` + accumulated `items`), so a restart resumes mid-range —
  chunks upsert keyed `(file, type, page, deepIdx)` making reruns
  idempotent. scanned_text items land as `type:"text"` chunks; everything
  else is `type:"figure"` with `figureType` metadata.
- **Daily quota via TTL counter.** `deepanalysisquotas` keyed
  `userId:YYYY-MM-DD` with a lazily-created TTL index — same pattern as
  the web-search cap, no schema change needed, self-cleaning.
- **Table analyst: structured spec, never generated code.** The model
  only emits a declarative spec (`filters/groupBy/aggs/orderBy/limit/
  chart`); `services/tableQuery.js` validates every column against the
  `tableMeta` allow-list, checks op/type compatibility, clamps `limit` to
  1000 and executes in plain server code over a fresh streaming parse
  (row + time caps). No `eval`/`Function`, no query strings from model
  text; `contains` is a case-insensitive substring — never a RegExp.
  Group keys are `JSON.stringify`ed and stored in `Map`s so a column
  literally named `__proto__` is safe. Malformed specs return 422
  `retryable:true` — the client (and the agent) can rephrase. This is the
  same "model proposes, code disposes" boundary the agent tool registry
  already enforced; the alternative (NL→Mongo aggregation pipelines or
  generated JS) trades a one-prompt UX win for an injection surface with
  no allow-list.
- **csv-parse 7 + dynamic `import()`:** the initial pin hit a moderate
  prototype-pollution advisory (`<7.0.2`, columns path); 7.x is ESM-only,
  loaded via `import("csv-parse")` like `music-metadata`.
- **Free-tier implications:** deep analysis is bounded by page cap ×
  daily cap (each window is one vision call); ask-data is 1 spec call +
  1 short explanation call; image describe is 1 call — all behind the AI
  limiter. The eval fixtures deliberately use a sidecar description for
  the chart image so baseline runs don't spend calls on a path unit
  tests already cover.

## Phase 4 — Retrieval quality, hybrid search, quota-aware behavior, safe deletion

- **Quota classification is authoritative in `geminiHelper`.** Every Gemini
  error is classified (`classifyError`) into `rate-limit` (per-minute —
  retry with backoff, honoring `RetryInfo`/`"retry in Xs"` hints),
  `daily-quota` (per-day — no same-model hammering; skip straight to the
  next fallback model and mark it `dailyExhausted` for the rest of the
  process), `server` (5xx — retry), `model-missing` (permanent per model —
  skip), or `other`. All `UsageEvent`s carry the classified `errorCode`,
  and chat/agent return a stable `{code:"AI_QUOTA_EXHAUSTED"}` + friendly
  message when every fallback is daily-exhausted, instead of a raw 500.
  The alternative — one generic retry loop — was burning minutes of wall
  clock against a quota that resets tomorrow.
- **Ingestion jobs back off quota without burning attempts.** A 429-class
  failure requeues the job with `notBefore = now + retryAfter` and
  `statusMessage:"Waiting for AI quota"`; `attempts` only increments on
  real failures. The claim query requires `notBefore <= now`, so queued
  work parks itself until quota returns instead of failing the file after
  3 retried quota responses.
- **Hybrid keyword leg is a regular MongoDB text index — never an Atlas
  Search index.** M0 caps Atlas Search/Vector indexes at 3 (1 in use);
  `$text` on `{ user: 1, text: "text" }` gives owner-scoped keyword search
  for free (4KB index on the eval set). `default_language:"none"` stores
  no stemmer/stopwords: the product must not silently stem non-English
  documents, and the keyword leg is an *identifier rescue* leg, not a
  linguistic ranker. `ensureTextIndex()` replaces any conflicting legacy
  text index (MongoDB allows exactly one text index per collection).
- **Hybrid fusion: RRF(k=60), strict keyword admission, lower weight.**
  Keyword results must clear `RAG_KEYWORD_MIN_SCORE=3` (Mongo textScore ≈
  0.58/term, so ~5+ matching terms — measured empirically) and enter RRF
  at weight 0.5 so lexical noise can't outrank semantic hits.
  **Measured on the 40-query stress set:** vector-only MRR 0.8725;
  unweighted/unthresholded hybrid regressed paraphrase to 0.70 (lexical
  noise); min-score 2 still lost near-duplicate cases; min-score 3 +
  weight 0.5 *tied* vector-only on every category — never beat it.
  Per the spec's own rule, `RAG_HYBRID` defaults **OFF**; it is correct,
  tested, and one env var away for corpora where exact identifiers
  dominate. Keyword-only MRR is 0.35 — the leg is a rescue, not a ranker.
- **Rerank measured, not assumed.** LLM rerank of the top-15 fused
  candidates: identical MRR (0.8725), +~430ms p50, +1 generate call per
  query on free-tier quota. `RAG_RERANK` defaults **OFF**. The
  implementation (guard-wrapped texts, ordered-ID structured output
  validated as a subset of the candidates, 4s timeout, silent fallback,
  1h Mongo cache keyed by `userId+queryHash+candidateIdsHash`, UsageEvent
  `kind:"rerank"`) stays available and tested.
- **Query rewriting default ON — the only measured win.** Follow-up
  category MRR went 0.40 → 0.70 live (0.4 → 1.0 against gold rewrites);
  overall MRR 0.8725 → 0.9175 with zero category regressions. Gated
  (`looksContextDependent`: short/pronoun/no-entity, history exists,
  chat mode only) so it costs ~0.15 calls per query, not 1. The model
  emits `{needsRewrite, standalone}`; `needsRewrite:false` short-circuits
  unchanged queries. History is truncated and passed as data; failures
  return the original query. The stored user message is never rewritten —
  `rewrittenQuery` is persisted on the assistant message and surfaced as
  "Searched for: …" under the citations for transparency.
- **Chat summaries power Smart search.** `Chat.summary` (≤300 chars) +
  `summaryEmbedding` (same model/dims bookkeeping as chunks) refresh
  fire-and-forget after a message lands once the chat grew ≥10 messages
  (`SUMMARY_REFRESH_EVERY`); only truncated first/last slices are sent.
  Smart search does in-process cosine over ≤`SEARCH_MAX_CHATS` projected
  summary embeddings fused with title/summary keyword matches via RRF —
  no new Atlas index, consistent with the M0 index budget. File results
  reuse `retrieveChunks` (so a Smart query benefits from rewrite/rerank
  config and the hybrid flag automatically).
- **Account deletion is a registry-enforced cascade.** Every Mongoose
  model with a `user` path must appear in `utils/accountCascade.js`'s
  `CASCADE` array; `tests/phase4.test.js` fails the suite if any such
  model is unregistered — a Phase 5 model can't silently orphan data.
  Deletion requires the current password (password users) or
  email-match + short-lived confirmation token from an authenticated
  `POST /auth/delete-confirm` (OAuth-only users), removes GridFS blobs
  and model-less quota collections, and sits behind `authLimiter`.
- **Embedding cache makes evals near-free.** `getEmbedding` caches on
  disk (`evals/.embedding-cache/`, gitignored) keyed by
  `sha256(taskType|model|dims|text)`; cached hits don't count against
  `EVAL_MAX_CALLS` and the run reports real vs cached calls. The
  retrieval stress set runs generation-free (`--retrieval-only`), so the
  daily quota only ever pays for the ~35 generation calls of the full
  eval.
- **Free-tier implications:** per user message the default config costs
  ≤1 embed (retrieval) + 1 generate (answer) + ≤1 cheap rewrite call on
  ~15% of messages + ≤1 summary call per 10 messages. Hybrid adds 0 calls;
  rerank adds 1/query when enabled; Smart search adds 1 embed/query.
