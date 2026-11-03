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
- There are no formal tests configured in the current `package.json` scripts (`"test": "echo \"Error: no test specified\" && exit 1"`).
- `verify_ingestion.js` and `test_ingestion.js` are standalone end-to-end scripts for the RAG ingestion pipeline (require valid `GEMINI_API_KEY` + `MONGO_URI`).

## RAG Pipeline
- Ingestion: `POST /api/v1/files/upload` → `utils/dataLoader.js` → `utils/chunker.js` → `geminiHelper.getEmbedding()` → `chunks` collection.
- Retrieval: `utils/retriever.js` (`retrieveChunks`) — Atlas `$vectorSearch` first, local cosine-similarity fallback.
- Chat: `controllers/chatController.js` `sendMessage` auto-retrieves when the user has indexed docs (`useDocuments:false` disables; `documentIds` scopes retrieval).
- Temp uploads (`isTemp` / `saveToKB:false`) are never chunked, are deleted after the message, and stale ones are swept at server start.
- Env knobs: `RAG_TOP_K` (default 3), `RAG_MIN_SCORE` (default 0.5), `MAX_ATTACH_CHARS` (default 12000), `ATLAS_VECTOR_SEARCH_INDEX` (default `chunks_embedding_index`).
- Model knobs: `GEMINI_MODEL` (default `gemini-2.5-flash`), `GEMINI_FALLBACK_MODELS` (comma list), `GEMINI_EMBEDDING_MODEL` (default `gemini-embedding-2`, 3072 dims).

## Security Notes
- All `/api/v1/*` routes except auth register/login/OAuth are behind `requireSignIn`.
- `/uploads` is NOT served statically — files stream through `GET /api/v1/files/:fileId/view` (ownership-checked).
- Rate limits: `authLimiter` on `/api/v1/auth`, `aiLimiter` on `/api/v1/openai|chat|studio`.
- Refresh flow: `POST /api/v1/auth/refresh` accepts `{refreshToken}` (or httpOnly cookie); axios interceptor retries once on 401.
- Dev/test helper scripts live in `scripts/` (run from repo root).
- The Atlas vector index is auto-created (best-effort) at server start; on local MongoDB only the fallback path is used.
