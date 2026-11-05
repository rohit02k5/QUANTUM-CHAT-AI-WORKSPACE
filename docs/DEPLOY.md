# Deploying to Render (free tier)

The repo ships a Blueprint (`render.yaml`) that provisions two services:

| Service | Type | Notes |
|---|---|---|
| `quantum-api` | Web service (Node 24) | `npm ci` → `node server.js`, health check `/health` |
| `quantum-client` | Static site | `cd client && npm ci && npm run build`, SPA rewrite to `/index.html` |

Deploy: Render dashboard → **New → Blueprint** → pick the repo. Every
secret is `sync: false` in the Blueprint — enter values in the dashboard
when prompted (Environment → Add Environment Variable).

## Required environment variables

**Secrets (dashboard only, never committed):**

| Var | Purpose |
|---|---|
| `MONGO_URI` | Atlas connection string, database `quantum_ai` |
| `GEMINI_API_KEY` | Google AI Studio key |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | two different strong random secrets |
| `SMTP_EMAIL` / `SMTP_PASSWORD` | Gmail + app password (password reset mail) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | OAuth |

**Config:** `CLIENT_URL` (must equal the static site URL — it drives
CORS and OAuth redirects), `REACT_APP_API_URL` on the client (must equal
the API URL). Model/RAG/agent/ingestion knobs ship with safe defaults in
`render.yaml`; override only if needed.

## Atlas setup

- **Network Access**: add `0.0.0.0/0` (allow from anywhere). Render's
  outbound IPs are not static, so IP allow-listing cannot work on the
  free tier. Access is still protected by the database credentials.
- **Database**: `quantum_ai` — the app creates the `chunks` collection
  and the `chunks_embedding_index` vector index at boot (M0 allows 3
  search indexes; the app uses exactly 1 — do not create others).
- **Storage**: M0 gives 512MB. File bytes live in GridFS;
  `USER_STORAGE_MAX_MB` (default 100) keeps a single user from
  exhausting it.

## OAuth callback URLs

After both services are live, update the provider consoles:

- **Google**: `https://quantum-api.onrender.com/api/v1/auth/google/callback`
- **GitHub**: `https://quantum-api.onrender.com/api/v1/auth/github/callback`
- Authorized JavaScript origin: `https://quantum-client.onrender.com`

`CLIENT_URL` must match the client URL exactly — the OAuth success
redirect goes to `${CLIENT_URL}/oauth-success`.

## Free-tier behavior to expect

- **Cold starts**: the API sleeps after ~15 min idle; the first request
  takes ~30–60s. The ingestion job runner starts with the server, so
  queued jobs resume on wake (stale-lock requeue covers mid-job kills).
- **Ephemeral disk**: the filesystem is wiped on every deploy/restart.
  This is why uploads live in GridFS — nothing important may touch disk.
- **Restarts**: every deploy restarts the process; SIGTERM handling
  releases in-flight ingestion jobs back to `queued`.
- **RAM (~512MB)**: PDF/image parsing is size-capped server-side; don't
  raise `AUDIO_MAX_MB` / upload caps blindly on the free instance.

## SSE behind Render's proxy

Streaming chat (`/api/v1/chat/:id/stream`) and ingestion progress
(`/api/v1/files/:id/ingestion/stream`) use Server-Sent Events. Render's
proxy forwards them correctly, but:

- The app already sets `X-Accel-Buffering: no` and `Cache-Control:
  no-cache` — do not add a compression middleware in front of SSE routes.
- 15s heartbeats keep connections alive through idle timeouts.
- If a corporate proxy buffers anyway, the client falls back to
  non-streaming chat and to polling for job progress.

## Post-deploy smoke test

```
node scripts/smoke-test.js https://quantum-api.onrender.com
```

Verifies `/health`, registers a throwaway user, opens a chat stream
(asserts streaming + heartbeat), uploads a small PDF and watches it to
`ready` via SSE, asks a question and checks a citation arrives, probes a
Range request, then deletes the user and all its data. Exit code 0 =
healthy deploy.

## Rollback

Render keeps previous deploys — dashboard → service → **Rollback** picks
a prior image. Rolling back code never removes Mongo data: GridFS blobs,
chunks and jobs survive. If a bad deploy corrupted ingestion state,
requeue jobs via `POST /api/v1/jobs/:id/retry` or let the stale-lock
sweeper catch them on next boot (`INGEST_STALE_MS`, default 2 min).
