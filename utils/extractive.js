// Extractive fallback (Phase 6B): when every provider in the answer chain
// is unavailable, the reply is the top retrieved passages with citations —
// flagged degraded:true — instead of an error screen. Sources carry the
// same citation metadata a generated answer would.
const LABEL = "AI unavailable right now — showing the most relevant passages from your documents.";

function buildExtractiveReply(sources, { maxPassages = 3, maxChars = 1200 } = {}) {
    const list = (sources || []).slice(0, maxPassages);
    if (!list.length) return null;
    const parts = list.map((s, i) => {
        const where = [s.originalName || "document",
            s.page != null ? `page ${s.page}` : null,
            s.startSec != null ? `@${s.startSec}s` : null]
            .filter(Boolean).join(" · ");
        const snippet = String(s.snippet || "").trim();
        return `**${i + 1}. ${where}**\n${snippet}`;
    });
    let text = `${LABEL}\n\n${parts.join("\n\n")}`;
    if (text.length > maxChars) text = text.slice(0, maxChars) + "…";
    return text;
}

module.exports = { buildExtractiveReply, LABEL };
