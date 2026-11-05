# Quantum — an AI second brain that cites its sources and shows its work

![CI](https://github.com/rohit02k5/QUANTUM-CHAT-AI-WORKSPACE/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)

> Upload documents, meetings and data. Ask questions, run agents, study — every answer is grounded in your files, labelled with the provider/model that wrote it, and measured by a committed eval suite.

**DEMO_URL:** `https://quantum-chat-frontend.onrender.com` — click **"Try the demo"** on the login page (enabled when the deployment sets `DEMO_MODE=true`). The demo account is pre-seeded and restricted; recorded replays work even with zero AI quota.

---

## Why it's interesting

- **Trust, not vibes** — every answer carries inline citations (file, page, audio timestamp), a provider+model label, and a visible tool trace in agent mode. Quality is *measured* by `scripts/eval.js` against committed baselines — see [Quality](#quality--measured-not-claimed).
- **Built for free-tier reality** — a multi-provider LLM router (`utils/llm/`) with per-model circuit breakers, per-task chains, capability gating, a dev disk cache, and an extractive degraded mode that keeps the product useful when every provider is out of quota.
- **Security as a feature** — an enumerated route-authorization test fails CI on any unclassified route; a cross-user ownership matrix covers every resource; injection defenses are layered and eval-tested ([docs/SECURITY.md](docs/SECURITY.md)).

---

## Quality — measured, not claimed

All numbers below come from committed report files; each states the provider/model that produced it. Full tables and methodology live in `evals/` + `scripts/eval.js`.

| Metric | Score | Source (provider/model, date) |
|---|---|---|
| Faithfulness | 98.4% | `evals/baseline.json` (gemini/gemini-2.5-flash, 2026-11-05) |
| Fact coverage | 96.8% | same |
| Abstention accuracy | 100% | same |
| Injection-safe answers | 100% | same |
| Page / timestamp citation accuracy | 100% / 100% | same |
| Image QA / table-query accuracy | 100% / 100% | same |
| Retrieval MRR (40-query stress set) | 0.873 | `evals/retrieval-baseline.json` (vector mode) |
| Retrieval MRR (15-query identifier-hard set) | 0.867 | `evals/retrieval-hard-results.json` (gemini-embedding-2, 2026-11-05) |
| Agent: tool-selection / content accuracy | 100% / 100%, avg 2.64 steps | `evals/baseline.json` |

**Design-by-measurement:** hybrid retrieval is OFF because it measured *identical* to vector-only on the stress set — and on a purpose-built identifier-adversarial set (`evals/retrieval-hard-results.json`, zero rank diffs). Query rewriting is ON because it measured +0.045 MRR on follow-ups. Defaults follow data, not fashion.

---

## Live Demo

🔗 **Quantum AI:**  
 https://quantum-chat-frontend.onrender.com/login

---

## Core Modules

---

## Authentication & Security System (Enterprise-Grade)

Quantum is built with a **security-first architecture**, clearly demonstrated by its authentication flows.

### Features
- Email & Password authentication  
- OAuth 2.0 login with **Google** and **GitHub**  
- Secure **Sign Up / Sign In / Forgot Password** flows  
- Encrypted password storage using **bcrypt**  
- Password reset via **secure email token (SMTP)**  

### Security Design
- **JWT Access Tokens** (15 minutes)  
- **JWT Refresh Tokens** (15 days)  
- Tokens stored in **HttpOnly cookies** (XSS-safe)  
- **Helmet.js** for secure headers (CSP, XSS, CSRF)

*Screenshots show clean, professional authentication UI — exactly what production apps require.*

---

## Quantum Chat — Context-Aware Conversational AI

> An intelligent assistant designed for **deep reasoning, learning, and productivity**.

### Capabilities
- Context-retaining multi-turn conversations  
- **Token-by-token streaming** over SSE (`POST /api/v1/chat/:chatId/stream`) with a Stop button — aborted answers persist as *partial* so history is never inconsistent; falls back automatically to the classic endpoint  
- **Personas** — built-in presets (Analyst, Tutor, Code Reviewer, Executive Briefer) plus custom ones via `/api/v1/personas`; applied per chat but can never override the injection guardrails  
- **Chat organization** — pinned chats, tags + tag filtering, inline-renamable titles, and auto-generated titles on the cheapest model  
- Coding help, explanations, reasoning, and creativity  
- Chat history persisted in **MongoDB**  
- File-aware intelligence (chat with documents)  

### Unique Feature
- **One-click conversion of conversations into structured mind maps** using **Mermaid.js**, enabling visual understanding of complex topics.

---

## RAG Engine — Chat With Your Documents

> Ask questions and get answers **grounded in your own files**, powered by a full Retrieval-Augmented Generation pipeline.

### Ingestion Pipeline
- Upload **PDF / DOCX / TXT / MD / CSV / JSON** files  
- Documents are parsed into structured `Document` objects with metadata (`utils/dataLoader.js`)  
- **Recursive text chunking** (1000 chars, 200 overlap) preserves context across chunk boundaries (`utils/chunker.js`)  
- Each chunk is embedded with **Gemini Embedding** (`EMBEDDING_DIMS`, 768 by default) and stored in a `chunks` collection — dimension/model metadata is tracked per chunk so stale vectors are detected, not crashed on  

### Retrieval
- Queries are embedded and matched against your indexed chunks (`utils/retriever.js`)  
- **MongoDB Atlas `$vectorSearch`** as the primary path (auto-created index)  
- **Local cosine-similarity fallback** — works on any MongoDB, no Atlas required  
- Similarity threshold (`RAG_MIN_SCORE`) filters out irrelevant context  
- **Optional hybrid retrieval** (`RAG_HYBRID`): a regular MongoDB **text index**
  `{ user: 1, text: "text" }` runs an owner-scoped keyword leg in parallel,
  fused with the vector leg via **Reciprocal Rank Fusion** (`RAG_RRF_K=60`).
  The keyword leg is a *rescue* leg for exact identifiers — a strict
  textScore admission threshold (`RAG_KEYWORD_MIN_SCORE=3`) and a lower RRF
  weight keep lexical noise out. Every filter (owner, READY files, file
  scoping, embedding model/dims) applies identically to both legs, and the
  keyword leg still works when the vector index is missing.
- **Query rewriting** (`RAG_REWRITE`, default ON): context-dependent
  follow-ups ("How long does *it* take?") are condensed into standalone
  queries using the last 4 turns as data — for retrieval only; the stored
  message is untouched and failures fall back to the original. Measured
  +0.045 overall MRR (follow-up category 0.40 → 0.70).
- **Optional LLM rerank** (`RAG_RERANK`, default OFF): reorders the top 15
  fused candidates on the cheapest model with a 4s timeout, ID-subset
  validation, and a 1h Mongo cache. Measured: identical MRR for +1 call/query
  and ~400ms — off until it earns its cost.

```mermaid
flowchart LR
    Q[user message] --> RW{context-dependent?}
    RW -- yes --> RWQ[standalone query<br/>cheapest model]
    RW -- no --> E
    RWQ --> E[embed query]
    E --> VL[vector leg<br/>Atlas $vectorSearch<br/>or cosine fallback]
    E --> KL[keyword leg<br/>regular text index<br/>user:1 + text]
    KL --> ADMIT{textScore >= 3?}
    ADMIT -- yes --> FUSE[RRF fusion k=60]
    VL --> FUSE
    FUSE --> RR{RAG_RERANK?}
    RR -- yes --> RRO[LLM reorder top 15<br/>validated, cached]
    RR -- no --> K[top-K]
    RRO --> K
    K --> G[guard.wrapSources<br/>untrusted data]
    G --> LLM[Gemini answer<br/>+ citation chips]
```

### Chat Integration
- Retrieval runs **automatically** when you have indexed documents — just ask  
- Scope answers to **specific documents** via the Knowledge Base picker (`documentIds`)  
- **Temporary attachments** (`saveToKB: false`) are never indexed and are deleted after the message  
- Tunable via env vars: `RAG_TOP_K`, `RAG_MIN_SCORE`, `MAX_ATTACH_CHARS`  

---

## Insight Engine — Deep Content & Knowledge Intelligence

> Transform raw text into **actionable intelligence**.

### Features
- Readability analysis (Flesch–Kincaid)  
- Tone & sentiment analysis  
- Estimated reading time  
- Entity extraction (organizations, concepts, topics)  
- **Interactive 3D Knowledge Graphs**  
- **Content DNA radar charts**

### Visualization Stack
- **Plotly.js** — 3D entity relationships  
- **Chart.js** — radar & analytics charts  

### Use Cases
- Market & business analysis  
- SEO & content evaluation  
- Academic research  
- Strategic writing  

---

## Quantum Studio — Document Intelligence Workspace

> A powerful learning and research environment.

### Capabilities
- Upload multiple documents (**PDF / TXT / DOCX**)  
- Compare documents side-by-side  
- Generate structured summaries  
- Auto-create **flashcards** for revision  
- Ideal for exams, research papers, and knowledge synthesis  

---

## NeuraPix — AI Image Generation Studio (Integrated)

**NeuraPix**, your previous AI Image Generator project, is now **fully integrated into Quantum** as a creative intelligence module.

### Features
- Text-to-image generation  
- Powered by **Stable Diffusion via Hugging Face**  
- Prompt-driven creative workflows  
- High-quality AI-generated visuals  

### Why This Matters
This demonstrates:
- Modular system design  
- Reusability of prior projects  
- Real-world integration of **GenAI pipelines**

---

## Knowledge Base — Persistent AI Memory

> Your personal AI knowledge repository.

### Features
- Stores uploaded files & insights  
- Files are **automatically indexed for RAG** on upload (chunked + embedded)  
- Select specific documents to **scope chat retrieval** to just those sources  
- Global search across workspace  
- Acts as long-term AI memory  
- Enables reuse of past intelligence  

---

## Executive Assistant — Strategy & Decision Intelligence

> AI outputs designed for **business and leadership contexts**.

### Outputs
- Executive summaries  
- Action items  
- Strategic gaps & risks  
- Decision-ready insights  

---

## AI & Intelligence Stack

| Function | Technology |
|--------|------------|
| Conversational AI | Google Gemini Pro |
| Embeddings & RAG | Gemini Embedding + MongoDB Atlas Vector Search |
| Document Parsing | pdf-parse, Mammoth (DOCX) |
| Image Generation | Hugging Face (Stable Diffusion) |
| NLP & Analysis | Natural, Sentiment.js |
| Knowledge Graphs | Plotly.js (3D) |
| Visualization | Chart.js, Mermaid.js |

---

## Tech Stack

### Frontend
- React.js 18  
- React Router v6  
- Tailwind CSS + Emotion  
- Material UI (MUI v5)  
- Framer Motion (animations)  
- Plotly.js (3D graphs)  
- Mermaid.js (mind maps)

### Backend
- Node.js  
- Express.js  
- MongoDB Atlas  
- Mongoose ODM  
- JWT + Passport.js  
- Nodemailer (SMTP)  
- OAuth 2.0 (Google & GitHub)

---

## Architecture Philosophy

- Modular & scalable backend  
- Clear separation of concerns  
- API-first design  
- Stateless authentication  
- Cloud-deployment ready  

---

## Engineering Challenges & Learnings

- Designing secure OAuth + JWT token rotation  
- Managing long AI conversation context efficiently  
- Rendering performant 3D knowledge graphs  
- Orchestrating multiple AI services in a unified UX  
- Handling SPA routing & OAuth redirects in production  

---

## High-Level Architecture

```text
Frontend (React)
   ↓
Backend (Express API)
   ↓                    ↘
AI Services      RAG Pipeline
(Gemini,         (Loader → Chunker →
Hugging Face)     Embedder → Retriever)
   ↓                    ↙
MongoDB Atlas (docs + vector index)
```
---
## Quality, Testing & Observability

Quantum treats RAG quality as a *measured* property, not a hope.

### Tests
```text
npm test          # Vitest + Supertest + in-memory MongoDB — fully offline
npm run test:watch
```
Covers auth flows (register/refresh/reject), cross-user ownership isolation,
chunker behavior, the retriever's cosine fallback when Atlas `$vectorSearch`
is unavailable, and file-stream privacy. A deterministic Gemini mock
(`GEMINI_MOCK=1`) means CI needs no API key. GitHub Actions runs tests on
every PR and builds the client.

### Health & usage
- `GET /health` — `{status, uptimeSec, version, db:{ok,latencyMs}, vectorIndex, models}`; 503 when the DB is down.
- Every Gemini call writes a `UsageEvent` (kind, model, tokens, latency, requestId) — see `GET /api/v1/usage/me` and the Usage panel on the dashboard.
- Structured logs via pino with `x-request-id` correlation end to end.

### RAG eval harness
```text
npm run eval              # against MONGO_URI (or EVAL_MONGO_URI)
node scripts/eval.js --memory   # fully self-contained (in-memory DB)
```
Runs the real retrieval + generation path against `evals/fixtures/` and
`evals/golden/questions.json` (including unanswerable and prompt-injection
cases), scoring **hit@k, MRR, faithfulness, relevance, fact coverage,
abstention accuracy, and injection-safety**. Reports land in
`evals/reports/`; the run fails if a metric regresses more than
`EVAL_REGRESSION_THRESHOLD` vs `evals/baseline.json`.

A second, retrieval-only stress harness (`npm run eval:retrieval`, or
`scripts/gen-retrieval-fixtures.js` + `scripts/eval-retrieval.js`) measures
40 labelled queries over 40 self-written distractor documents across five
categories — paraphrase, exact-identifier, multi-document, near-duplicate,
and pronoun-dependent follow-ups — and caches query embeddings on disk so
reruns cost zero API calls.

### Retrieval ablation (40-query stress set, in-memory)

| config | hit@1 | hit@3 | hit@5 | MRR | p50 | extra calls/query |
|---|---|---|---|---|---|---|
| vector-only (baseline) | 0.83 | 0.90 | 0.95 | **0.87** | 586ms | 0 |
| keyword-only | 0.33 | 0.38 | 0.38 | 0.35 | 8ms | 0 |
| hybrid (RRF k=60) | 0.83 | 0.90 | 0.95 | 0.87 | ~20ms | 0 |
| hybrid + rerank | 0.83 | 0.90 | 0.95 | 0.87 | ~450ms | +1 |
| vector + rewrite (live) | **0.88** | **0.95** | **0.98** | **0.92** | — | ~0.15* |

*rewrite only fires on context-dependent follow-ups (~6/40 queries);
follow-up category MRR 0.40 → 0.70. Default config: **vector + rewrite ON,
hybrid and rerank OFF** — hybrid never beat vector-only on this set and
rerank buys no MRR; both stay opt-in. See `docs/DECISIONS.md`.

| metric | Phase 0 (no guardrails) | Phase 1 (guardrails on) | Phase 3B |
|---|---|---|---|
| hit@k | 0.95 | **0.95** | **0.97** |
| MRR | 0.89 | **0.93** | **0.93** |
| faithfulness | 0.86 | **0.98** | **0.95** |
| relevance | 0.95 | **1.00** | **1.00** |
| fact coverage | 0.91 | **1.00** | **0.97** |
| abstention accuracy | 0.75 | **1.00** | **1.00** |
| injection-safe | 0.50 | **1.00** | **1.00** |
| timestamp citations | — | — | **1.00** |
| page citations | — | — | **1.00** |
| image QA | — | — | **1.00** |
| table queries | — | — | **1.00** |
| mean latency | 6.9s | 14.9s* | 9.6s* |

*includes free-tier 429 back-off during the run; not regression-gated.

Phase 3B agent metrics (11 cases in `evals/golden-agent.json`):
tool-selection **1.0** · avg steps **2.5** · content accuracy **1.0** ·
abstention **1.0** · injection-safe **1.0** — including `analyze_table`
calling a CSV analyst over `sales.csv`.

Guardrails (Phase 1): every retrieved chunk/attachment is wrapped in
`<source>` delimiters, delimiter-like text inside sources is neutralized,
instruction-like content is flagged (shown on the citation chip, never
obeyed), and the guardrail block is the last — authoritative — part of the
system instruction so personas can't override it.

---

## Agent Mode — Multi-Step Tool Use

Switch the composer from **Chat** to **Agent** and the assistant becomes a
tool-using agent on the same streaming endpoint
(`POST /api/v1/chat/:chatId/stream` with `{mode:"agent", browse:bool}`).
The loop is `model → function calls → server-side tools → results back →
repeat` until a final answer — capped by `AGENT_MAX_STEPS` (5),
`AGENT_TIMEOUT_MS` (45s) and `AGENT_MAX_TOOLS_PER_STEP` (3). On any limit it
forces a final answer from gathered context; Stop/disconnect aborts the
whole run and still persists the partial answer **with its trace**.

| tool | what it does |
|---|---|
| `search_knowledge_base` | RAG over the user's documents (owner-scoped; foreign `fileIds` silently dropped) |
| `list_documents` | the user's files — id, name, kind, status (≤50) |
| `get_document_overview` | cached per-document summary (generated once on the cheapest model) |
| `create_flashcards` | generates + persists a study deck (≤20 cards) |
| `analyze_table` | stub — `{ok:false, "not available yet"}` (wired in Phase 3.4) |
| `web_search` | Google Search grounding — registered only when **Browse** is on, `WEB_SEARCH_DAILY_CAP` per user/day |

**Safety:** tool args are validated with zod; every tool result passes
through `guard.js` (untrusted-data wrapping + injection detection) before
going back to the model; `userId` is server-injected, never taken from the
client or the model. `FEATURE_AGENT=false` disables cleanly and hides the UI.

Every tool call streams live events (`tool_call`/`tool_result`) and the
answer keeps a persisted, collapsible **"How I got this answer"** timeline:

```text
▾ How I got this answer (2 steps)
  ⚙ search_knowledge_base      41ms
      {"query":"apollo 11 crew","topK":5}
      3 chunk(s) retrieved
  ⚙ web_search                 1180ms
      {"query":"apollo 11 50th anniversary"}
      answer + 2 source(s) (19 quota left)

[example.com] [nasa.gov]      ← web sources render as domain chips
[apollo_history.txt • 82%]    ← KB citations render as before (⚠ when flagged)
```

### Re-embedding migration
If `EMBEDDING_DIMS` or `GEMINI_EMBEDDING_MODEL` ever changes, existing chunks
must be re-embedded (the retriever ignores mismatched-dimension vectors):
```text
node scripts/reembed.js --dry-run   # preview what would be re-embedded
node scripts/reembed.js             # batched, resumable, idempotent
```

---

## Ingestion pipeline — resumable jobs, GridFS, audio

Uploads are stored in **GridFS** (bucket `uploads`) — never on the app's
ephemeral disk — then ingested by an in-process job runner as an
`IngestionJob`. `POST /api/v1/files/upload` returns `202 {fileId, jobId}`;
`INGEST_SYNC=true` keeps the old synchronous `201` contract for tests and
small files.

```mermaid
stateDiagram-v2
    [*] --> queued: upload → GridFS + job
    queued --> processing: findOneAndUpdate (atomic claim, lockedAt)
    processing --> extract: documents
    processing --> transcribe: audio (windowed, resumable)
    extract --> chunk
    transcribe --> chunk
    chunk --> embed: batched (backoff on 429/5xx)
    embed --> index: upsert (file, seq) — idempotent
    index --> done: file.status=ready
    processing --> queued: crash/stale lock → requeue (attempts++)
    processing --> failed: attempts ≥ INGEST_MAX_ATTEMPTS
    failed --> queued: POST /api/v1/jobs/:id/retry
    done --> [*]
```

- **Progress**: `GET /api/v1/files/:id/ingestion/stream` (SSE, owner-only,
  heartbeats) or `GET /api/v1/jobs/:id` polling; failed jobs can be retried
  via `POST /api/v1/jobs/:id/retry`. The Knowledge Base shows live progress
  bars and a Retry action.
- **Resumable**: chunk writes are idempotent upserts keyed `(file, seq)`;
  transcript windows persist per-job so a restart never redoes them. Stale
  `processing` locks are requeued at boot (`INGEST_STALE_MS`); SIGTERM
  releases in-flight claims back to `queued`.
- **Readiness**: files carry `status: processing|ready|failed` — only
  `ready` files are retrievable by RAG and agent tools (`list_documents`
  still shows them with their status).
- **Storage safety**: per-user cap `USER_STORAGE_MAX_MB` (100MB default);
  deleting a file removes its GridFS blob, chunks and jobs; legacy disk
  files migrate via `node scripts/migrate-to-gridfs.js [--dry-run]`.
- **Privacy**: files stream through `GET /api/v1/files/:fileId/view`
  (ownership-checked, HTTP **Range** support — no public URLs).

### Audio → transcript → meeting minutes

- **Formats**: mp3 / m4a / wav / ogg / flac, validated by **magic bytes**;
  caps `AUDIO_MAX_MB` (25) and `AUDIO_MAX_MIN` (30), duration read
  server-side via `music-metadata`.
- **Transcription**: `GEMINI_TRANSCRIBE_MODEL` (verified via `listModels`
  at boot, falls back to the chat model). Small files go inline; larger
  ones use the **Gemini Files API**, always deleted in `finally`. Long
  audio is transcribed in `AUDIO_SEGMENT_SEC` windows — each window is a
  resumable checkpoint on the job.
- Transcripts are grouped into ~1000-char chunks carrying
  `metadata.startSec/endSec/speakers`, pass through the same
  `guard.js` injection screening as any source, and produce **mm:ss
  citation chips** that seek the authenticated player.
- **Meeting Minutes** (Executive Assistant):
  `POST /api/v1/openai/meeting-minutes` returns structured
  `{summary, decisions[], actionItems[{owner,task,due?,sourceSec?}],
  openQuestions[], risks[]}` — every item carries a seekable timestamp
  chip; client-side Markdown export included.
- `FEATURE_AUDIO=false` disables the pipeline and hides the UI.

---

## Multimodal ingestion — page citations, images, deep analysis

- **Page-level citations**: PDFs are chunked per page — a chunk never
  spans pages and carries `metadata.page`. Citation chips render `p.N`
  and open an authenticated `pdfjs-dist` viewer at that page. Pages below
  `PDF_MIN_PAGE_CHARS` are recorded on `File.pagesWithoutText`; the KB
  card shows *"N pages look scanned — run Deep analysis to read them."*
  PDFs ingested before page metadata get a **Reprocess** action that
  regenerates text chunks only (figure chunks survive; a failed run keeps
  the old index).
- **Image ingestion** (`FEATURE_MULTIMODAL`, `IMAGE_MAX_MB=8`): png/jpg/
  jpeg/webp, validated by **magic bytes**. A `describe` stage produces a
  structured `{caption, ocrText, dataInsights, tags}` — stored on
  `File.description` and embedded as `type:"image"` chunks. OCR text is
  **untrusted**: it flows through the same `<source>` wrapping +
  injection detector as any retrieved data (visual prompt injection is
  real). Clicking an image citation opens the viewer showing the picture
  beside its description and extracted text.
- **Deep analysis** (`POST /api/v1/files/:id/deep-analysis {pageStart,
  pageEnd}`): user-triggered vision pass that reads figures, tables,
  charts and scanned pages in a PDF range — capped at
  `MULTIMODAL_MAX_PAGES` (20) per run and `DEEP_ANALYSIS_DAILY_CAP` (3)
  per user per day (TTL counter). `pdf-lib` slices ~5-page windows into
  small PDFs for Gemini; structured output maps back to original page
  numbers and lands as `type:"figure"` chunks (scanned_text → text
  chunks), resumable per window and idempotent on rerun. Results are
  citable — "what does the chart on page 4 show?" returns a `p.4` chip.

## Ask your data — the CSV analyst

Every CSV gets a streaming column profile at ingest (`tableMeta` —
types, nulls, min/max/mean, top values, `TABLE_MAX_ROWS` cap).

**"Ask your data"** on any CSV card asks a question in plain English:

```text
"average revenue by region as a bar chart"
  → Gemini emits a STRUCTURED spec (never code):
    {groupBy:["region"], aggs:[{col:"revenue",fn:"avg"}],
     orderBy:{col:"avg_revenue",dir:"desc"}, chart:{type:"bar",...}}
  → services/tableQuery.js validates every column/op against the
    allow-list, then executes it in plain server code over a fresh
    streaming parse (row + TABLE_QUERY_TIMEOUT_MS caps)
  → {rows, rowCount, truncated, chartSpec} + a one-line explanation
```

The panel shows the generated spec collapsibly ("how I computed this"),
the result table, and an editable-type Plotly chart. Malformed specs get
a friendly retryable error. `analyze_table` gives the **agent** the same
capability with identical validation and ownership checks. No
`eval`/`Function`, no model-written queries, `contains` is a substring
never a RegExp, and group keys are `Map`-safe against `__proto__`
columns.

---
## Long-Term Memory — a second brain that remembers (opt-out)

Quantum can remember durable facts about you — preferences, role, goals,
projects — and use them to personalize every later chat and agent run.

```text
user turn ──► every MEMORY_EVERY_N_TURNS turns AND only when a cheap
   local heuristic sees durable first-person statements
      ──► cheap-model extraction (≤3 items, structured JSON)
      ──► server-side sensitive-data denylist drops credentials/ids
      ──► dedupe: cosine > MEMORY_DEDUPE_THRESHOLD updates in place
      ──► insert with MEMORY_MAX cap (LRU eviction, logged)
next turn ──► top-MEMORY_TOP_K above MEMORY_MIN_SCORE (in-process cosine,
   per-user capped set — no new Atlas index) injected AFTER the persona
   and BEFORE the guardrail rules
```

**Security boundaries:** extraction reads *user-authored text only* —
document chunks, attachments, transcripts, tool results, web results and
assistant text never reach the extraction prompt, so a poisoned document
can't write memories. The prompt forbids sensitive data **and** a
server-side regex drops passwords, keys, tokens, government/financial
identifiers, health details and precise locations regardless of what the
model returns. Injection-flagged memories are dropped from the prompt.

API: `GET/POST /api/v1/memories`, `PATCH/DELETE /api/v1/memories/:id`,
`DELETE /api/v1/memories` (forget all), `GET /api/v1/memories/export`,
`PATCH /api/v1/me/memory {enabled}` — all owner-scoped. The Memory page
groups memories by category with inline edit, forget-all, a count against
the cap, and a global toggle; replies show a "used N memories" chip.

## Study Mode — spaced repetition from your documents

Decks and cards (SM-2 scheduling, pure `services/sm2.js`), review
sessions, 7-day forecasts, streaks, retention stats — plus AI-generated
quizzes graded on the server.

- `services/sm2.js` is a pure function `(state, grade 0-5, now) -> state`:
  grade < 3 resets reps and lapses, ease floors at 1.3 — unit-tested
  against a hand-computed sequence.
- `POST /api/v1/study/review` validates ownership, writes a `ReviewLog`
  (1-year TTL) and guards double-submits; `GET /api/v1/study/stats`
  computes streaks in the caller's timezone (`tz` param, IANA-validated).
- Quizzes: `POST /api/v1/study/quiz {fileId|deckId, count<=10}` — the
  cheap model emits structured MCQs over guard-wrapped source text;
  server-side validation requires exactly 4 unique options and a valid
  index; `submit` grades from the stored snapshot (client-sent scores
  ignored) and returns explanations.
- `STUDY_MAX_CARDS` caps total cards per user; `migrate-flashcards-to-decks.js`
  moves legacy `FlashcardSet` data (idempotent, `--dry-run`, never deletes).
- Studio's flashcard generation has an **Add to deck** button; the
  agent's `create_flashcards` tool produces Decks/Cards directly.

## Export — your data, portable

- **Chat → Markdown** (`GET /api/v1/export/chat/:id`, or the download
  button in Chat): title, timestamps, messages, citations as footnotes,
  agent-trace summary.
- **Flashcards → CSV** (`GET /api/v1/export/cards.csv`): UTF-8 with BOM,
  `Front,Back,Deck` columns, RFC-4180 quoting, and formula-injection
  protection — cells starting `= + - @` get a leading apostrophe. Pass
  `?escape=0` for raw/Anki-compatible output.
- **Memories → JSON** (`GET /api/v1/memories/export`).
- A print stylesheet (`client/src/print.css`) makes chats and flashcards
  print/PDF cleanly from the browser. No public share links — every
  export endpoint is owner-authenticated.

## Public API — query your knowledge base from anywhere

Create a key in **Settings → API keys** (shown once, stored as SHA-256,
max 5 active), then call the Bearer-authenticated endpoint:

```bash
curl -X POST https://your-host/api/v1/public/chat \
  -H "Authorization: Bearer qk_..." \
  -H "Content-Type: application/json" \
  -d '{"message":"summarize my notes","fileIds":["<fileId>"],"topK":5}'
# -> {"answer":"...","sources":[{"fileId","name","page","snippet"}],"usage":{...}}
```

- Retrieval is scoped to **that key owner's READY files** — `fileIds` are
  intersected with ownership; foreign ids are silently dropped. Same
  guard-wrapped RAG path as in-app chat (no agent, tools, web search,
  memory, or uploads).
- Limits: 30 req/15 min per key (keyed by key id, not IP),
  `API_KEY_DAILY_CAP`/day per key which also counts toward the owner's
  `USER_DAILY_AI_CAP`, 16 KB body limit, 2 KB message cap. Revoked and
  unknown keys get 401. `UsageEvent` rows record `kind:"api"` + `apiKeyId`.
- The route is Bearer-only (cookies ignored), so it uses a permissive CORS
  policy scoped to `/api/v1/public/*` — the app-wide whitelist is
  untouched for every other route.

---
## Multi-provider resilience (Phase 6)

All AI calls route through `utils/llm/` — the only layer allowed to touch a provider SDK or URL:

```mermaid
flowchart LR
    C[chat / agent / studio] --> R[LLM router<br/>utils/llm]
    R --> CH[per-task chains<br/>LLM_CHAIN_* env]
    CH --> P1[Gemini<br/>@google/genai]
    CH --> P2[Groq<br/>OpenAI-compatible]
    CH --> P3[OpenRouter<br/>OpenAI-compatible]
    R --> CB[circuit breaker<br/>per provider:model]
    R --> U[UsageEvent telemetry<br/>provider + model + cache]
    R --> Q[per-user daily cap<br/>ADMIN exempt]
```

- **Chains** — `LLM_CHAIN_ANSWER|CHEAP|AGENT|VISION|TRANSCRIBE|JUDGE`, each `provider:model` entries tried in order; boot validation drops unknown models.
- **Circuit breaker** — per `provider:model`: closed → open (daily quota → provider-reset or `LLM_DAILY_COOLDOWN_MS`) → half-open probe → closed. Auth failures get a long cooldown and surface in `/health`.
- **Streaming** fails over only before the first token; after the first token it ends `truncated:true`, never silently switches mid-answer.
- **Capability gating** — vision/PDF/transcription/tools/grounded-search only route to providers that declare them; otherwise a clean "unavailable with current providers" message.
- **Privacy gate** — `LLM_ALLOWED_PROVIDERS` pins which providers may see user content.
- **Degraded modes** — all providers down → extractive reply with citations (`degraded:true`); embeddings down → keyword-only retrieval (works without `RAG_HYBRID`); agent mode with no tool-capable provider → friendly refusal + document list.
- **Dev/eval** — `LLM_CACHE=disk` caches deterministic calls (never production); `eval.js --provider=` runs per-provider baselines.
- `utils/geminiHelper.js` is now a thin compatibility shim — all legacy callers and tests unchanged.

### Demo mode (zero-quota portfolio demo)

`DEMO_MODE=true` enables `POST /api/v1/auth/demo` ("Try the demo" on the login page) for a seeded, restricted demo account — no uploads, API keys, or account deletion; `DEMO_DAILY_AI_CAP` budget. `scripts/seed-demo.js` reseeds from `scripts/demo-seed.snapshot.json` (embeddings generated once, committed) with **zero AI calls**. `GET /api/v1/demo/replay/:id` streams three recorded scenarios through the same SSE path — always labelled *"Recorded replay, not a live model call"*.

### Security hardening (Phase 6.2)

- `tests/security-matrix.test.js` auto-enumerates every Express route and fails CI unless each is on an explicit public allow-list or returns 401 unauthenticated — plus a cross-user read/update/delete/stream matrix for every owned resource.
- Dependabot (weekly, grouped) + `npm audit --omit=dev --audit-level=high` in CI.
- Secrets scan of tree **and** git history: clean (fixtures/placeholders only). Threat model: [docs/SECURITY.md](docs/SECURITY.md).

## Local Setup

```text
git clone https://github.com/rohit02k5/QUANTUM-CHAT-AI-WORKSPACE.git
cd QUANTUM-CHAT-AI-WORKSPACE
cp .env.example .env    # fill in: MONGO_URI, GEMINI_API_KEY, JWT_* secrets
npm install
npm run server          # http://localhost:8080
cd client && npm install && npm start   # http://localhost:3000
```

**Every environment variable is documented inline in `.env.example`** (placeholders only — nothing hardcoded). Provider keys beyond Gemini are optional: set `GROQ_API_KEY`/`OPENROUTER_API_KEY`, verify model names via `node scripts/llm-smoke.js`, then add them to `LLM_CHAIN_*`.

### Testing & eval

```text
npm test                              # full suite: Vitest + mongodb-memory-server, offline (GEMINI_MOCK=1)
node scripts/eval.js --memory         # real RAG eval vs committed baseline (costs API calls)
node scripts/eval-retrieval.js --memory --mode=vector   # retrieval ablation
node scripts/llm-smoke.js             # one tiny call per configured provider
node scripts/seed-demo.js             # reseed demo account (zero AI calls)
```

Environment
```text
cp .env.example .env   # then fill in your values (Mongo URI, Gemini key, OAuth, SMTP, JWT secrets)
```

Backend
```text
npm install
npm run server   # http://localhost:8080
```
Frontend
```text
cd client
npm install
npm start        # http://localhost:3000 (proxies /api → :8080)
```
Deployment Ready
Quantum is production-ready and designed for deployment on platforms like Render or Vercel.

SPA routing handled correctly

OAuth redirect-safe

Environment-based configuration

Secure CORS policies



Screenshots & UI Highlights

Screenshots demonstrate authentication flows, AI chat, document intelligence, 3D graphs, and executive insights.

<img width="1919" height="916" alt="Screenshot 2025-12-14 164516" src="https://github.com/user-attachments/assets/932350f9-e891-4c6f-be5e-19915d9f97ca" />
<img width="1919" height="896" alt="Screenshot 2025-12-14 164504" src="https://github.com/user-attachments/assets/4f6bd8bf-f121-42fd-9869-ab644832775c" />
<img width="1919" height="866" alt="Screenshot 2025-12-14 164605" src="https://github.com/user-attachments/assets/26a8a7e2-a8b4-4777-818a-7d47630e4feb" />
<img width="1891" height="897" alt="Screenshot 2025-12-12 223530" src="https://github.com/user-attachments/assets/ea8d2f37-b15b-4ec2-8832-21b682a03637" />
<img width="1911" height="890" alt="Screenshot 2025-12-12 230217" src="https://github.com/user-attachments/assets/d6cb3174-a9eb-4687-ba7f-47e5b1f6d256" />
<img width="1884" height="897" alt="Screenshot 2025-12-12 231022" src="https://github.com/user-attachments/assets/a27c9b16-4533-4e3e-bd2e-89f3e184470f" />
<img width="1721" height="914" alt="Screenshot 2025-12-12 231005" src="https://github.com/user-attachments/assets/6ae1fabf-405c-4734-a780-6040ff5f0b1d" />
<img width="1718" height="886" alt="Screenshot 2025-12-12 231609" src="https://github.com/user-attachments/assets/10e392a3-b3b2-4da6-8c81-5079906ada1e" />
<img width="1883" height="897" alt="Screenshot 2025-12-12 231638" src="https://github.com/user-attachments/assets/a169b37a-dca3-471e-b271-8988b73a13af" />
<img width="1894" height="891" alt="Screenshot 2025-12-12 231717" src="https://github.com/user-attachments/assets/3b47a9f0-25f1-4c1d-bd8b-eb442b70bded" />
<img width="1894" height="895" alt="Screenshot 2025-12-12 232629" src="https://github.com/user-attachments/assets/18574d9f-f645-463c-9c49-fb964a0fc175" />
<img width="1881" height="869" alt="Screenshot 2025-12-12 232843" src="https://github.com/user-attachments/assets/8e76531d-cf4f-490a-99b4-d9e793471b8e" />
<img width="1866" height="891" alt="Screenshot 2025-12-12 232954" src="https://github.com/user-attachments/assets/367ed399-d6cf-481e-a94a-ee9b3650106b" />
<img width="1874" height="894" alt="Screenshot 2025-12-12 233108" src="https://github.com/user-attachments/assets/82246672-5c9e-4e7d-abd3-67cc5e95fd93" />
<img width="1914" height="900" alt="Screenshot 2025-12-12 233308" src="https://github.com/user-attachments/assets/934328b2-8c45-4782-ba0e-eac66e388b70" />

## Project structure

```text
app.js / server.js          Express app + bootstrap (indexes, boot validation, job runner, SIGTERM)
controllers/  routes/       Feature endpoints; every route owner-scoped or public-allowlisted
utils/llm/                  Multi-provider router: providers/, circuit, capabilities, telemetry, disk cache
utils/geminiHelper.js       Thin compatibility shim over the router
utils/retriever.js          Vector + keyword retrieval, identifier-rescue admission, degraded modes
services/agent.js           Agent loop → tools/ registry (zod-validated, owner-scoped)
evals/                      Golden sets + committed baselines (the numbers in this README)
scripts/                    eval, retrieval ablation, re-embed, demo seed/replay, smoke tests
tests/                      Vitest + Supertest + mongodb-memory-server (~200 tests)
client/                     React 18 (CRA): pages, SSE client, landing page
docs/                       SECURITY.md, DECISIONS.md, DEPLOY.md, DEMO_SCRIPT.md, INTERVIEW.md, PRODUCTION_CHECKLIST.md
```

## Honest limitations

- **M0 shared Atlas tier** — 512MB, one vector index (currently 1/3 slots), `0.0.0.0/0` IP allow-list because Render egress IPs are dynamic.
- **Free-tier provider quotas** are the binding constraint; degraded modes ride over them but can't create quota.
- **Injection detector is heuristic** — measured 100% on our eval set, not a formal guarantee (defense in depth is the real control).
- **In-process job runner + in-memory circuits** — correct at this scale; a worker queue and shared circuit state are the next step.
- Full production hardening checklist: [docs/PRODUCTION_CHECKLIST.md](docs/PRODUCTION_CHECKLIST.md).

## Roadmap

- Live multi-provider chains (Groq/OpenRouter) — machinery shipped, awaiting keys
- Worker-based ingestion queue + shared circuit state for horizontal scaling
- Per-provider committed eval baselines once a second provider has quota
- Dedicated Atlas tier + least-privilege DB user (see production checklist)

Authors

**Swarna Venkata Sai Rohit** and **Harshita**

GitHub: https://github.com/rohit02k5

GitHub: https://github.com/harshita-sl
