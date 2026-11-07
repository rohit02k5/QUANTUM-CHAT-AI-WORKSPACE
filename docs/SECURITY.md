# Security Model

Plain-language description of how Quantum protects user data, what it defends
against, and — just as important — what it does **not** guarantee.

## Authentication and tokens

- Passwords are bcrypt-hashed; they are never logged or returned by any endpoint.
- Sessions use short-lived JWT access tokens (default 24h) plus rotating
  refresh tokens (default 15d). Refresh tokens can be carried in an
  `httpOnly` cookie or the request body; the client retries a failed request
  once after refreshing.
- OAuth (Google/GitHub) issues the same token pair after the provider
  callback — the app never sees OAuth passwords.
- Password reset and account-deletion use separate single-purpose tokens.

## Ownership scoping

Every user-owned resource — chats, files, chunks, jobs, memories, decks,
cards, quiz attempts, API keys, personas, embeddings cache — is queried with
`{user: req.user._id}` and nothing else. Cross-user access returns 404
(not 403) so resource existence is not leaked. `tests/security-matrix.test.js`
enumerates the route table automatically and asserts every route is either on
an explicit public allow-list or returns 401 without a token; it also runs a
cross-user read/update/delete/stream matrix for every resource type.

## File privacy

- `/uploads` is **never** served statically. Files stream only through
  `GET /api/v1/files/:fileId/view`, which checks ownership before opening the
  GridFS/stream. There are no public media URLs.
- Temp attachments (`saveToKB:false`) are never chunked, are deleted after
  the message completes, and stale ones are swept at server start.

## Prompt-injection defenses (layers, not a guarantee)

Retrieved documents and tool results are untrusted input. In order:

1. `utils/guard.js` wraps every retrieved chunk/attachment in `<source>` tags
   and neutralizes delimiter-smuggling inside them.
2. A heuristic detector flags instruction-like content inside sources
   (`sources[].flagged` in the response).
3. `GUARDRAIL_RULES` is appended **last** in the system instruction, so
   personas cannot override it.
4. Tool results are `<tool_result>`-wrapped and run through the same scan.
5. The eval harness includes injection cases (golden `questions.json`):
   injection-safety measured 1.00 on the committed Phase-4 baseline
   (`evals/baseline.json`, provider gemini).

## Memory-poisoning defense

Long-term memories are extracted **only from user-authored message text**,
never from document content — a poisoned PDF cannot plant a memory by
construction. A denylist filters credential-shaped strings (API keys,
passwords, tokens) before storage. Verified by the poisoned-fixture eval case
and `tests/phase5-memory.test.js`.

## Structured table specs

The "ask your data" feature returns a **validated JSON spec** (chart type,
aggregation, columns) that deterministic code executes — the model never
writes executable code or a Mongo query. Specs are zod-validated with a
repair retry, then the router fails over.

## Rate limits and quotas

- `authLimiter` on `/api/v1/auth`, `aiLimiter` on chat/studio/openai routes
  (`AI_RATE_MAX` per 15 min per IP).
- `USER_DAILY_AI_CAP` per-user daily AI counter (TTL'd; admins exempt).
- Public API keys have their own per-key rate limit and daily cap, which also
  counts toward the owner's cap — a leaked key cannot exceed the owner's
  budget.

## Public API keys

- Keys (`qk_…`) are shown once at creation; only the SHA-256 hash plus an
  8-char prefix are stored. Verification is timing-safe.
- Keys are Bearer-only on `/api/v1/public/chat` — no session cookies, no
  elevation to the web API. That route alone uses permissive CORS by design
  (it's a public API surface); it is also the only route mounted before the
  global JSON parser with a 16 KB body limit.
- Key-scoped retrieval can only see the **owner's** READY files.

## Deletion cascade

Account deletion walks a registry (`utils/accountCascade.js`) covering every
owned artifact — chats, files + GridFS blobs, chunks, jobs, memories, decks,
cards, review logs, quiz attempts, API keys, personas, web-search quotas,
embedding cache, usage events. Verified by cascade tests that assert zero
remaining documents/blobs.

## Third-party LLM data processing

User content is sent to whichever provider the router selects for a task
(`utils/llm/`). Plain facts:

- **Gemini**: prompts, retrieved document text, memories, and (for media
  features) file bytes go to Google's API under your key's terms.
- **Groq / OpenRouter** (optional): OpenAI-compatible chat-completions APIs.
  Some providers' free tiers may use submitted data for service improvement —
  **check each provider's current terms before enabling them**.
- `LLM_ALLOWED_PROVIDERS` is the privacy gate: set it (e.g. `gemini`) to pin
  all user content to specific providers. Chains are filtered through it.
- Provider names and models are recorded on assistant messages and
  `UsageEvent`s so you can audit which provider answered what.
- `LLM_CACHE=disk` writes request/response bodies to `.cache/llm` for dev and
  eval only — it is hard-disabled when `NODE_ENV=production`.

## Headers, CORS, secrets

- Helmet is enabled; CORS is an explicit whitelist (`CLIENT_URL` + same-origin
  requests) except the public API-key route.
- Error responses never include stack traces or internal IDs.
- Secrets live only in env vars; provider keys never appear in `/health`,
  logs, or error responses (asserted by tests).

## Known limitations (candid)

- **The injection detector is heuristic.** It raises the cost of attacks and
  measured 1.00 on our eval set — it is not a formal guarantee. Defense in
  depth (wrapping, guardrails-last, least-privilege tools) is the real control.
- **M0 shared Atlas tier.** Single replica set, 512 MB, one vector index
  (currently 1/3 index slots used). A noisy-neighbor cluster event can slow
  queries; there is no failover database.
- **`0.0.0.0/0` Atlas IP allow-list** — Render's egress IPs are dynamic, so
  the cluster accepts connections from any IP. Access still requires database
  credentials (SCRAM), and network-level isolation requires a paid tier's
  private endpoint / IP pinning.
- **Free-tier provider quotas.** Daily caps on free keys are the binding
  resource constraint; the multi-provider router and degraded modes exist to
  ride over them, but with every provider exhausted, generation is degraded
  (extractive fallback) rather than full.
- **In-process job runner.** Ingestion jobs run inside the API process; a
  crash mid-job is recovered via `notBefore` requeue, but a dedicated worker
  is the correct production shape.
- **Single-process circuits.** LLM circuit-breaker state is in-memory per
  process — a horizontal scale-out would need shared state (e.g. Redis).

## Reporting

If you find a vulnerability, please open a private security report rather than
a public issue.
