// Provider-agnostic error classification. Superset of the original Gemini
// classifier in utils/geminiHelper.js — same kind/code contract plus the
// kinds the multi-provider router needs (auth, content-blocked, malformed,
// invalid-request, timeout, no-providers).
//
//   daily-quota     per-day quota exhausted; open circuit until reset → AI_QUOTA_EXHAUSTED
//   rate-limit      per-minute limit; brief backoff, retry/fail over     → AI_RATE_LIMITED
//   server          5xx/Overloaded transient                             → AI_UNAVAILABLE
//   timeout         client-side abort/timeout (transient)                → AI_UNAVAILABLE
//   model-missing   configured model does not exist (config error)       → AI_MODEL_MISSING
//   auth            bad/expired key; disable provider/model until boot   → AI_AUTH
//   invalid-request 4xx that retrying cannot fix (bad params)            → AI_INVALID_REQUEST
//   content-blocked safety/policy refusal; do NOT blind-failover         → AI_CONTENT_BLOCKED
//   malformed       response unparseable/invalid structured output       → AI_MALFORMED
//   no-providers    every chain candidate unavailable                    → AI_NO_PROVIDERS
//   other           anything else                                        → AI_ERROR
function classifyError(error) {
    const msg = String(error?.message || error || "");
    const status = error?.status ?? error?.statusCode ?? error?.error?.code;
    let retryAfterMs;
    const details = error?.error?.details || error?.details || [];
    const retryInfo = Array.isArray(details)
        ? details.find((d) => /RetryInfo/i.test(d?.["@type"] || ""))
        : null;
    const rd = retryInfo?.retryDelay || "";
    const rdMatch = String(rd).match(/([\d.]+)\s*s/);
    if (rdMatch) retryAfterMs = Math.round(parseFloat(rdMatch[1]) * 1000);
    const msgRetry = msg.match(/retry in\s+(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:([\d.]+)\s*s)?/i);
    if (retryAfterMs == null && msgRetry && (msgRetry[1] || msgRetry[2] || msgRetry[3])) {
        retryAfterMs = Math.round(
            ((+msgRetry[1] || 0) * 3600 + (+msgRetry[2] || 0) * 60 + (+msgRetry[3] || 0)) * 1000
        );
    }

    if (error?.noProviders || error?.code === "AI_NO_PROVIDERS" || error?.code === "AI_QUOTA_EXHAUSTED") {
        const isQuota = error?.code === "AI_QUOTA_EXHAUSTED";
        return { kind: isQuota ? "daily-quota" : "no-providers", code: error?.code || "AI_NO_PROVIDERS", retryAfterMs: error?.retryAfterMs ?? retryAfterMs, status };
    }
    if (error?.name === "AbortError" || /aborted|abort/i.test(msg) && !status) {
        return { kind: "aborted", code: "ABORTED", retryAfterMs, status };
    }
    if (/timeout|timed out|ETIMEDOUT|ECONNRESET|fetch failed|network/i.test(msg) && !status) {
        return { kind: "server", code: "AI_UNAVAILABLE", retryAfterMs, status };
    }

    const isQuota = status === 429 || /RESOURCE_EXHAUSTED|quota exceeded|rate limit/i.test(msg);
    if (isQuota) {
        const daily = /per.?day|PerDay|daily|GenerateRequestsPerDay|rpd|requests per day/i.test(msg);
        return {
            kind: daily ? "daily-quota" : "rate-limit",
            code: daily ? "AI_QUOTA_EXHAUSTED" : "AI_RATE_LIMITED",
            retryAfterMs,
            status,
        };
    }
    if (status === 401 || status === 403 || /unauthorized|invalid api key|forbidden|permission denied|authentication/i.test(msg)) {
        return { kind: "auth", code: "AI_AUTH", retryAfterMs, status };
    }
    if ((status >= 500 && status < 600) || /Overloaded|unavailable|internal error/i.test(msg)) {
        return { kind: "server", code: "AI_UNAVAILABLE", retryAfterMs, status };
    }
    if (/content.?block|safety|blocked|policy violation|finishReason.{0,20}SAFETY/i.test(msg)) {
        return { kind: "content-blocked", code: "AI_CONTENT_BLOCKED", retryAfterMs, status };
    }
    if (status === 404 || /model.{0,15}not found|not found|does not exist/i.test(msg)) {
        return { kind: "model-missing", code: "AI_MODEL_MISSING", retryAfterMs, status };
    }
    if (status === 400 || status === 422 || /invalid|bad request|malformed request/i.test(msg)) {
        return { kind: "invalid-request", code: "AI_INVALID_REQUEST", retryAfterMs, status };
    }
    return { kind: "other", code: "AI_ERROR", retryAfterMs, status };
}

// Map classifyError kind -> circuit failure kind.
function circuitKind(cls) {
    switch (cls.kind) {
        case "daily-quota": return "daily-quota";
        case "rate-limit": return "rate-limit";
        case "auth":
        case "model-missing":
            return "auth"; // disable until boot — these won't heal by retrying
        case "server": return "transient";
        default: return null; // aborted/content-blocked/malformed don't burn the circuit
    }
}

/** Structured error the router throws when every candidate is unavailable. */
function noProvidersError(task, lastCls) {
    const err = new Error(lastCls?.kind === "daily-quota"
        ? "All AI providers are quota-exhausted"
        : "No AI provider is available right now");
    err.noProviders = true;
    err.code = lastCls?.kind === "daily-quota" ? "AI_QUOTA_EXHAUSTED" : "AI_NO_PROVIDERS";
    err.task = task;
    err.lastErrorCode = lastCls?.code;
    err.retryAfterMs = lastCls?.retryAfterMs;
    return err;
}

module.exports = { classifyError, circuitKind, noProvidersError };
