# AGENTS.md

This file contains high-signal information for agents working on the Quantum AI Intelligence Suite.

## Project Structure
- `root/`: Backend Express.js server (`server.js`).
- `client/`: React 18 frontend (CRA).

## Development Commands
- `npm run dev`: Runs both server and client concurrently (recommended).
- `npm run server`: Starts the backend server (nodemon).
- `npm run client`: Starts the frontend client.

## Key Conventions & Quirks
- **Environment Variables**: The project relies on `.env` (not committed) for API keys (Gemini, Hugging Face, etc.) and database connection strings. Ensure these are present for local development.
- **Proxy**: Client uses `http-proxy-middleware` to communicate with the backend.
- **Frontend Frameworks**: Uses Tailwind CSS, Material UI (MUI), and Framer Motion. 3D graphs are handled via `react-plotly.js`.
- **Backend Authentication**: Uses JWT (Access/Refresh tokens) with `httpOnly` cookies and `passport.js` for OAuth (Google/GitHub).

## Testing
- `npm test` runs the Vitest suite (`tests/`) — Vitest + Supertest + mongodb-memory-server, fully offline. Vitest `globals: true` is on; test files are CommonJS and must NOT `require("vitest")`.
- `GEMINI_MOCK=1` swaps in `utils/geminiMock.js` (deterministic seeded embeddings + canned generation); `tests/setup.js` enables it automatically.
- Tests import `app.js` (Express app only); `server.js` does bootstrap (connect, vector-index creation, temp-file sweep, listen).
- CI: `.github/workflows/ci.yml` runs backend tests + client build on PRs (Node 24).
- Eval harness: `node scripts/eval.js --memory` runs the real RAG path on `evals/fixtures` + `evals/golden/questions.json`, writes `evals/reports/`, and fails on regression vs `evals/baseline.json` (`EVAL_REGRESSION_THRESHOLD`, default 0.10). Costs real Gemini calls — cap with `EVAL_MAX_CALLS`, pace with `EVAL_PACE_MS`.
- `verify_ingestion.js` and `test_ingestion.js` are standalone end-to-end scripts for the RAG ingestion pipeline (require valid `GEMINI_API_KEY` + `MONGO_URI`).

## RAG Pipeline
- Ingestion: `POST /api/v1/files/upload` → `utils/dataLoader.js` → `utils/chunker.js` → `geminiHelper.getEmbedding()` → `chunks` collection.
- Retrieval: `utils/retriever.js` (`retrieveChunks`) — Atlas `$vectorSearch` first, local cosine-similarity fallback.
- Chat: `controllers/chatController.js` `sendMessage` auto-retrieves when the user has indexed docs (`useDocuments:false` disables; `documentIds` scopes retrieval).
- Temp uploads (`isTemp` / `saveToKB:false`) are never chunked, are deleted after the message, and stale ones are swept at server start.
- Env knobs: `RAG_TOP_K` (default 3), `RAG_MIN_SCORE` (default 0.5), `MAX_ATTACH_CHARS` (default 12000), `ATLAS_VECTOR_SEARCH_INDEX` (default `chunks_embedding_index`).
- Model knobs: `GEMINI_MODEL` (default `gemini-2.5-flash`), `GEMINI_FALLBACK_MODELS` (comma list), `GEMINI_EMBEDDING_MODEL` (default `gemini-embedding-2`), `EMBEDDING_DIMS` (default 768 — must match the Atlas vector index; changing it requires `node scripts/reembed.js`).
- Chunks store `embeddingModel` + `embeddingDims`; the retriever ignores chunks that don't match the active embedding config.

## Streaming & Guardrails (Phase 1)
- `POST /api/v1/chat/:chatId/stream` (`:chatId` may be `"new"`) — SSE events as `data: {"type":"meta|token|done|error"}`. Abort via `res` "close" → partial saved with `truncated:true`.
- `utils/guard.js` wraps ALL retrieved chunks/attachments in `<source>` tags, neutralizes embedded delimiters, flags instruction-like text (→ `sources[].flagged`), and appends `GUARDRAIL_RULES` LAST in the system instruction (personas can't override). Used by sendMessage, streamMessage, and eval.
- Personas: presets in `config/personas.js` + `/api/v1/personas` CRUD (owner-scoped); chats get `personaKey|personaId`, `pinned`, `tags` via `PATCH /api/v1/chat/:id`. Auto-title runs on the cheapest fallback model.
- Rate limiter is env-tunable: `AI_RATE_MAX`; tests enable it with `TEST_RATE_LIMIT=1`.
- mongodb-memory-server is pinned via `MONGOMS_VERSION` and cached at `.cache/mongodb-binaries` (CI caches this dir).

## Agent Mode (Phase 2)
- `mode:"agent"` on the stream endpoint runs `services/agent.js`: model → `functionDeclarations` → server-side tools → results back → repeat (caps: `AGENT_MAX_STEPS`, `AGENT_TIMEOUT_MS`, `AGENT_MAX_TOOLS_PER_STEP`). Limits force a tools-off final answer.
- Tool registry is `tools/index.js` — `{name, description, parameters, schema(zod), handler(ctx,args)}`; `ctx.userId` is server-injected, never from args. Results are `<tool_result>`-wrapped + injection-scanned via `guard.js`.
- `web_search` = separate `generateContent` call with `googleSearch` grounding (never combined with function declarations); only registered when `browse:true`; `WEB_SEARCH_DAILY_CAP` tracked in `websearchquotas` (TTL).
- SSE adds `tool_call`/`tool_result` events; persisted `message.trace` + web sources (`{title,uri,domain}`). `FEATURE_AGENT=false` disables cleanly.
- Tests script the model deterministically via `utils/geminiMock.js` `__setAgentScript([{functionCalls:[...]},{text}]})`.
- `@google/genai` stays confined to `utils/geminiHelper.js` — function-calling helpers (`generateAgentTurn`, `getFunctionCalls`, `getResponseParts`) live there.

## Security Notes
- All `/api/v1/*` routes except auth register/login/OAuth are behind `requireSignIn`.
- `/uploads` is NOT served statically — files stream through `GET /api/v1/files/:fileId/view` (ownership-checked).
- Rate limits: `authLimiter` on `/api/v1/auth`, `aiLimiter` on `/api/v1/openai|chat|studio`.
- Refresh flow: `POST /api/v1/auth/refresh` accepts `{refreshToken}` (or httpOnly cookie); axios interceptor retries once on 401.
- Dev/test helper scripts live in `scripts/` (run from repo root).
- The Atlas vector index is auto-created (best-effort) at server start; on local MongoDB only the fallback path is used.

## Ingestion Jobs, GridFS & Audio (Phase 3A)
- File bytes live in **GridFS** (bucket `uploads`, `utils/gridfs.js`); `File.gridfsId` is canonical, `path` is legacy-only. `/view` supports HTTP Range. `scripts/migrate-to-gridfs.js` migrates legacy disk files (`--dry-run`, idempotent).
- Uploads return `202 {fileId, jobId}` and queue an `IngestionJob` (status/stage/progress/attempts/lockedAt/state). `INGEST_SYNC=true` keeps the old sync `201` path — tests set this in `tests/ingestion.test.js` per-suite.
- `utils/jobRunner.js`: poll loop + atomic `findOneAndUpdate` claim; chunk upserts keyed `(file, metadata.seq)`; embed watermark `job.state.nextSeq`; transcript windows `job.state.audio.doneWindows`. Boot requeues stale locks (`INGEST_STALE_MS`); SIGTERM releases in-flight jobs. `GET /api/v1/jobs/:id`, `POST .../retry`, `GET /api/v1/files/:id/ingestion/stream` (SSE).
- `File.status` (`processing|ready|failed`) — retriever + agent tools exclude non-ready files; `list_documents` shows real status.
- Audio: magic-byte sniffed (`utils/audio.js`), `music-metadata` (ESM, dynamic `import()`) for duration; caps `AUDIO_MAX_MB`/`AUDIO_MAX_MIN`. `GEMINI_TRANSCRIBE_MODEL` verified at boot (falls back to `GEMINI_MODEL`). Inline ≤ `AUDIO_INLINE_MAX_MB`, else Files API (always deleted in `finally`). Long audio transcribes in `AUDIO_SEGMENT_SEC` windows — resumable per window.
- Transcript chunks carry `metadata.startSec/endSec/speakers`; `<source>` tags expose `start="Ns"`; chat citations show `mm:ss` chips that seek `AudioPlayerModal` (fetch-to-blob). Meeting template: `POST /api/v1/openai/meeting-minutes`.
- Tests: `GEMINI_MOCK` handles media parts (transcript JSON, `__setTranscript`, `__mediaFiles`/`__resetMedia` for Files-API lifecycle assertions).
- Eval: `EVAL_MONGO_DB` overrides the db name on a shared cluster (Atlas eval → `quantum_ai_eval`); eval cleans its user/files/chunks/jobs unless `--keep`. Timestamp-citation metric scores `expectsTimestamp` questions.

## Multimodal & Table Analyst (Phase 3B)
- PDFs chunk **per page** (`metadata.page`); `File.pagesWithoutText` flags scanned pages; `POST /api/v1/files/:id/reprocess` regenerates text chunks (figure/image chunks survive). pdf-parse v2: use `getText()` → `result.pages[]` — there is NO `pageIndex` option.
- Images (png/jpg/jpeg/webp, magic-byte checked, `IMAGE_MAX_MB`) get a `describe` stage → `File.description` + `type:"image"` chunks. OCR/description text is untrusted — same `guard.js` wrapping.
- `POST /api/v1/files/:id/deep-analysis` (`aiLimiter`, `MULTIMODAL_MAX_PAGES`, `DEEP_ANALYSIS_DAILY_CAP` TTL counter) → job `kind:"deep-analysis"` → `utils/deepAnalysis.js` slices page windows via `pdf-lib`, vision calls → `type:"figure"` chunks (scanned_text → text), resumable via `job.state.deepAnalysis.doneWindows`.
- CSV analyst: `services/tableQuery.js` — `computeTableMeta` (streaming profile on `File.tableMeta`), `validateSpec` (allow-list columns, op/type checks, `Map`-safe keys, `contains`=substring), `executeSpec` (re-parse, row/time caps). `POST /api/v1/files/:id/ask-data` = NL→spec via `geminiHelper.planTableQuery` → validate → execute (+ optional explanation). Agent tool `analyze_table` shares the same path. **No model-written code ever executes.**
- csv-parse 7.x and music-metadata are ESM → always `await import()`, never `require()`.
- Env: `FEATURE_MULTIMODAL`, `GEMINI_VISION_MODEL`, `IMAGE_MAX_MB`, `MULTIMODAL_MAX_PAGES`, `DEEP_ANALYSIS_DAILY_CAP`, `DEEP_ANALYSIS_WINDOW_PAGES`, `TABLE_MAX_ROWS`, `TABLE_QUERY_TIMEOUT_MS`, `PDF_MIN_PAGE_CHARS`.
