const mongoose = require("mongoose");
const { getRequestId, getUserId } = require("../requestContext");

/**
 * Records a UsageEvent for every provider call. Fire-and-forget: never
 * blocks or fails a request on telemetry problems. `provider` is additive
 * (Phase 6); everything else matches the pre-Phase-6 schema. Structured
 * metadata only — never prompts, secrets, or user content.
 */
function recordUsage({ kind, provider, model, latencyMs, ok, usageMetadata, errorCode, fallback, cacheHit }) {
    try {
        if (mongoose.connection.readyState !== 1) return;
        const UsageEvent = require("../../models/UsageEvent");
        UsageEvent.create({
            user: getUserId() || undefined,
            kind,
            provider: provider || undefined,
            model,
            promptTokens: usageMetadata?.promptTokenCount || 0,
            outputTokens: usageMetadata?.candidatesTokenCount || 0,
            latencyMs: Math.round(latencyMs || 0),
            ok: ok !== false,
            errorCode: errorCode ? String(errorCode).slice(0, 120) : undefined,
            requestId: getRequestId(),
            fallback: fallback === true || undefined,
            cacheHit: cacheHit === true || undefined,
        }).catch(() => {});
    } catch (e) {
        /* telemetry must never break the request path */
    }
}

module.exports = { recordUsage };
