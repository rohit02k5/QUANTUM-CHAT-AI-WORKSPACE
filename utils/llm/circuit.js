// Per-(provider,model) circuit breaker. In-process state, reconstructed on
// boot — no persistence needed since a restart re-derives it from real calls.
//
// States: closed (normal) -> open (failing, rejects calls until cooldown
// elapses) -> half-open (one probe allowed; success closes, failure re-opens
// with a longer cooldown). Daily-quota errors open until the provider's
// reported reset (or LLM_DAILY_COOLDOWN_MS). Auth/config errors disable the
// entry until next boot. Transient errors open after 3 CONSECUTIVE failures.
const OPEN_AFTER_FAILURES = 3;
const BASE_COOLDOWN_MS = 1000;
const MAX_COOLDOWN_MS = 60000;

class CircuitRegistry {
    constructor({ now = Date.now, dailyCooldownMs } = {}) {
        this._now = now;
        this._daily = dailyCooldownMs ?? parseInt(process.env.LLM_DAILY_COOLDOWN_MS || "21600000", 10); // 6h
        this._states = new Map(); // key "provider:model" -> state
    }

    _key(provider, model) {
        return `${provider}:${model}`;
    }

    _entry(provider, model) {
        const k = this._key(provider, model);
        let s = this._states.get(k);
        if (!s) {
            s = {
                state: "closed",
                failures: 0,          // consecutive transient failures
                opensAt: null,
                cooldownMs: BASE_COOLDOWN_MS,
                reopensAt: null,
                lastErrorCode: null,
                disabled: false,      // auth/config — until next boot
                probing: false,
            };
            this._states.set(k, s);
        }
        return s;
    }

    /**
     * May a call proceed for this provider/model? Recomputes transitions
     * from wall time. Returns { allowed, state, reopensAt, reason? }.
     */
    allow(provider, model) {
        const s = this._entry(provider, model);
        if (s.disabled) return { allowed: false, state: "disabled", reason: "auth-or-config", lastErrorCode: s.lastErrorCode };
        const now = this._now();
        if (s.state === "open") {
            if (s.reopensAt == null || now >= s.reopensAt) {
                if (s.probing) return { allowed: false, state: "half-open", reopensAt: s.reopensAt, reason: "probe-in-flight" };
                s.state = "half-open";
                s.probing = true;
                return { allowed: true, state: "half-open" };
            }
            return { allowed: false, state: "open", reopensAt: s.reopensAt, lastErrorCode: s.lastErrorCode };
        }
        if (s.state === "half-open" && !s.probing) {
            s.probing = true;
            return { allowed: true, state: "half-open" };
        }
        if (s.state === "half-open") {
            return { allowed: false, state: "half-open", reopensAt: s.reopensAt, reason: "probe-in-flight" };
        }
        return { allowed: true, state: "closed" };
    }

    /** Successful call — closes the circuit, resets counters. */
    success(provider, model) {
        const s = this._entry(provider, model);
        s.state = "closed";
        s.failures = 0;
        s.probing = false;
        s.cooldownMs = BASE_COOLDOWN_MS;
        s.reopensAt = null;
        s.lastErrorCode = null;
    }

    /**
     * Record a failure. `kind` comes from classifyError:
     * "transient" (5xx/timeout) counts toward the open threshold with
     * exponential jittered cooldown; "daily-quota" opens until resetAt;
     * "auth"/"config" disables until boot; "rate-limit" is a short open.
     */
    failure(provider, model, { kind = "transient", retryAfterMs, errorCode } = {}) {
        const s = this._entry(provider, model);
        s.probing = false;
        s.lastErrorCode = errorCode ? String(errorCode).slice(0, 80) : s.lastErrorCode;
        const now = this._now();

        if (kind === "auth" || kind === "config") {
            s.disabled = true;
            s.state = "disabled";
            return s;
        }
        if (kind === "daily-quota") {
            s.state = "open";
            s.failures = 0;
            s.reopensAt = now + Math.min(retryAfterMs || this._daily, 24 * 3600 * 1000);
            return s;
        }
        if (kind === "rate-limit") {
            s.state = "open";
            s.reopensAt = now + Math.min(retryAfterMs || 5000, MAX_COOLDOWN_MS);
            return s;
        }
        // transient
        s.failures += 1;
        const wasProbing = s.state === "half-open";
        if (wasProbing || s.failures >= OPEN_AFTER_FAILURES) {
            s.state = "open";
            // exponential backoff with jitter, capped at 60s
            const base = Math.min(s.cooldownMs * 2, MAX_COOLDOWN_MS);
            const jitter = Math.floor(Math.random() * base * 0.5);
            s.cooldownMs = Math.min(base + jitter, MAX_COOLDOWN_MS);
            s.reopensAt = now + s.cooldownMs;
            if (wasProbing) s.failures = OPEN_AFTER_FAILURES;
        }
        return s;
    }

    /** Aborted/non-provider errors should not count against the circuit. */
    abort(provider, model) {
        const s = this._entry(provider, model);
        s.probing = false;
        if (s.state === "half-open") s.state = "open";
    }

    /**
     * Snapshot for /health — names, states, timings, last error code only.
     * Never includes secrets, URLs, prompts, or request content.
     */
    status() {
        const out = [];
        for (const [k, s] of this._states) {
            const [provider, model] = k.split(":");
            out.push({
                provider,
                model,
                state: s.state,
                reopensAt: s.reopensAt ? new Date(s.reopensAt).toISOString() : undefined,
                lastErrorCode: s.lastErrorCode,
            });
        }
        return out;
    }

    /** Test hook — reset everything. */
    reset() {
        this._states.clear();
    }
}

module.exports = { CircuitRegistry };
