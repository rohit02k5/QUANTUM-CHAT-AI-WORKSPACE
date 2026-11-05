# Production Checklist

What must be true before Quantum serves real users — and which items are **not yet done** (marked ☐). ✅ = done in code or verified.

## Provider spend

- ☐ **Billing + spend caps on provider keys** — set hard budget alerts in Google AI Studio / Groq / OpenRouter consoles. Free tiers currently act as the cap.
- ✅ Per-user daily cap (`USER_DAILY_AI_CAP`) + per-key caps — a leaked key can't exceed the owner's budget.
- ✅ `LLM_ALLOWED_PROVIDERS` privacy gate exists; document chosen providers' terms in the deployment runbook.
- ☐ Review each provider's current data-use terms (free tiers may use submitted data — see docs/SECURITY.md).

## Database (Atlas)

- ☐ **Upgrade from M0** — shared tier, 512MB, single replica set; target M10+ for production.
- ☐ **Least-privilege DB user** — current connection uses a broad-scope user; create one scoped to the app database only.
- ☐ **Narrow the IP allow-list** — currently `0.0.0.0/0` because Render egress IPs are dynamic; use a dedicated egress or private endpoint on a paid tier.
- ☐ **Backups** — M0 has no point-in-time restore; scheduled `mongodump` or paid-tier continuous backup.
- ✅ Vector index auto-ensured at boot; index count verified 1/3 slots (do NOT create new indexes without checking the limit).
- ☐ Storage growth monitoring — `USER_STORAGE_MAX_MB` caps per user, but cluster-level alerting is not configured.

## Runtime

- ✅ Graceful shutdown (SIGTERM): SSE streams end cleanly, jobs requeue, DB disconnects.
- ✅ Health endpoint with provider circuit status (no secrets).
- ☐ **Job runner as a worker** — ingestion runs in the API process; move to a separate dyno/worker for production scale.
- ☐ **Monitoring/alerting** — pino logs exist; no external log drain or alert pipeline configured (Render log retention is short).
- ☐ Rate-limit sizing review under real traffic.
- ✅ `LLM_CACHE=disk` is hard-disabled in production.

## Secrets & accounts

- ☐ **Rotate all secrets** before public launch (JWT secrets, DB user, API keys, OAuth secrets, SMTP app password).
- ✅ Secrets are env-only; tree + git history scanned clean.
- ☐ OAuth apps set to production mode with final redirect URIs.
- ☐ Custom domain + HTTPS (Render handles TLS on custom domains).

## Product/legal

- ☐ **Privacy policy + data retention** — deletion cascade exists technically; a written retention policy does not.
- ☐ Decide whether user content may go to third-party LLM providers and disclose it.
- ✅ Account deletion removes all owned artifacts (cascade-tested, incl. embedding cache).
- ✅ Demo account is restricted (no uploads, keys, or deletion) — enable `DEMO_MODE` only on the portfolio deployment.

## CI/CD

- ✅ CI: backend tests + frontend build + `npm audit --omit=dev --audit-level=high`.
- ✅ Dependabot configured (weekly, grouped minor/patch).
- ☐ Deploy hook / smoke gate post-deploy (`scripts/smoke-test.js` against `SMOKE_BASE_URL`).
