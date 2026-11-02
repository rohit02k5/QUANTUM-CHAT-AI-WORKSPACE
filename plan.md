# Plan: RAG Layer for Quantum Chat AI

> **Status: Implemented** — all items below are done except live end-to-end LLM verification, which is blocked by an invalid `GEMINI_API_KEY` (all Gemini calls return 401 `ACCESS_TOKEN_TYPE_UNSUPPORTED`). Refresh the key, then run `node verify_ingestion.js`.

## 1. Current State — What Already Exists

After auditing the codebase, the RAG pipeline is **already ~85% implemented** (recent uncommitted work). Here is what exists today:

### Ingestion (upload → chunks → embeddings → MongoDB)
- `POST /api/v1/files/upload` → `controllers/fileController.js`
- `utils/dataLoader.js` — parses PDF (per-page, with `page` metadata), DOCX, TXT/MD, CSV (per-row docs), JSON into LangChain-style `{ pageContent, metadata }` documents.
- `utils/chunker.js` — recursive character splitter (chunkSize 1000, overlap 200).
- `utils/geminiHelper.js` → `getEmbedding()` using `models/gemini-embedding-2` (3072-dim).
- `models/Chunk.js` — stores `user`, `file`, `text`, `metadata`, `embedding` per chunk.

### Retrieval
- `utils/retriever.js` → `retrieveChunks(userId, query, topK)`:
  - Primary path: MongoDB Atlas `$vectorSearch` (index `chunks_embedding_index`, cosine).
  - Fallback: in-process cosine similarity over the user's chunks if Atlas search fails.
- `buildContext()` formats chunks into a `[Source N: filename (page X)]` block.

### Augmented Generation
- `controllers/chatController.js` → `sendMessage`: when `useDocuments` is true, retrieves top-3 chunks, wraps them in `=== SOURCES ===` markers, prepends grounding instructions, sends to Gemini.
- Sources metadata (fileId, name, score, snippet) is persisted on the message (`models/Chat.js`) and returned to the client.

### Frontend (`client/src/pages/Chat.js`)
- Attach-file button → `/api/v1/files/upload`.
- "Use my documents" checkbox → sends `useDocuments` flag.
- `MessageBubble` renders source chips with similarity % under AI replies.

---

## 2. Gaps & Bugs Found

| # | Issue | Severity |
|---|-------|----------|
| 1 | `generateMindmap` uses `GoogleGenerativeAI` but never imports it → `ReferenceError` (endpoint is broken). | Bug |
| 2 | No `DELETE /api/v1/files/:id` endpoint — files can't be removed, and chunks would orphan. | Gap |
| 3 | Frontend has a `saveToKB` checkbox + `File.isTemp` field, but `saveToKB` is never sent to the backend — every attachment is permanently ingested into the knowledge base. | Gap |
| 4 | Retrieval has no score threshold — irrelevant chunks get injected into the prompt anyway. | Quality |
| 5 | RAG only activates via the manual `useDocuments` checkbox — not automatic when docs exist. | UX decision needed |
| 6 | Embedding calls during ingestion are sequential — large docs are slow (N sequential API calls). | Perf |
| 7 | `fileId` attachment path appends the *entire* extracted file content to the prompt — can overflow context on large files. | Quality |
| 8 | Multer has no file size/type limits. | Hardening |
| 9 | Atlas vector index `chunks_embedding_index` must exist in Atlas UI (or fallback is always used — slow for large KBs). | Ops/verify |

---

## 3. Proposed Work (pending your answers below)

### Phase A — Correctness & Cleanup
1. Fix missing `GoogleGenerativeAI` import in `chatController.js` (one-line bug fix).
2. Add `DELETE /api/v1/files/:id` — removes the File doc, its chunks, and the file on disk.
3. Wire `saveToKB` → backend: attachments flagged `isTemp` are used only for that message, excluded from retrieval, and cleaned up.

### Phase B — RAG Quality
4. Add a relevance score threshold (e.g. drop chunks < ~0.5 cosine) so weak matches don't pollute the prompt; configurable `topK`.
5. Cap the `fileId` attached-content injection (truncate or retrieve-chunk the attached file instead of dumping full text).
6. Parallelize embeddings during ingestion (batched `Promise.all`, e.g. 5 at a time).
7. Multer limits: file size cap + mimetype allowlist matching `dataLoader`.

### Phase C — UX (depends on your answers)
8. Auto-RAG: when the user has indexed docs, retrieve automatically (or keep the toggle, or auto-with-override) — **your call**.
9. Optional: per-file retrieval scoping (search only selected documents).
10. Optional: show "indexing…" status on uploads since ingestion is async-heavy.

### Explicitly NOT changing
- Auth, routing structure, database schema shape, the chunking algorithm, or the embedding model (unless verification shows `gemini-embedding-2` fails — then I'll flag it).

---

## 4. How This Improves the Project

- **Grounded answers**: responses cite your actual documents instead of hallucinating — the core value of RAG.
- **Trust**: source chips + persisted citations let users verify where answers came from.
- **Correctness**: fixes the broken mindmap endpoint and orphaned-chunk data leak.
- **Privacy/cost control**: `isTemp` handling means one-off attachments don't permanently pollute the knowledge base or embedding costs.
- **Speed**: batched embeddings make uploads of large PDFs significantly faster.
- **Robustness**: score threshold + size limits prevent garbage context and abuse.

## 4.5 Decisions (confirmed with user)

| Decision | Choice |
|----------|--------|
| Scope | **Harden existing RAG** — keep the pipeline, fix bugs, fill gaps |
| Retrieval trigger | **Auto + toggle override** — default ON when the user has indexed docs; the "Use my documents" checkbox can disable per message |
| Temp files | **Wire it up** — `saveToKB`/`isTemp` uploads are used only for that message, never indexed, cleaned up after use (also honors `isTemp` already sent by ExecutiveAssistant.js) |
| Doc scoping | **Per-file selection** — UI to pick which KB files to retrieve from; empty selection = all docs |

## 5. Verification Plan
- Re-run existing scripts: `test_ingestion.js`, `test_chunk_embed.js`, `verify_ingestion.js`.
- Manual: upload a txt/pdf → toggle documents on → ask a question only answerable from the doc → confirm source chips appear.
- Confirm whether the Atlas vector index exists; otherwise rely on (and note) the local fallback.
