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
