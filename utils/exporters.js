/**
 * utils/exporters.js — Phase 5.3 export formatters (pure, unit-testable).
 * - chatToMarkdown(chat): titles, timestamps, turns, citations as footnotes.
 * - cardsToCsv(cards, deckNameById): RFC-4180 quoting, UTF-8 BOM added by the
 *   caller, and formula-injection protection ('-prefixed cells).
 */

/** RFC-4180 CSV cell escaping + spreadsheet formula-injection guard. */
function csvCell(value, { escapeFormula = true } = {}) {
    let s = value == null ? "" : String(value);
    // Cells starting with = + - @ are evaluated as formulas by Excel/Sheets —
    // a hostile card could exfiltrate via =WEBSERVICE(...). Prefix with '.
    if (escapeFormula && /^[=+\-@]/.test(s)) s = `'${s}`;
    if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
}

/**
 * Flashcard CSV. Columns: Front,Back,Deck.
 * `escapeFormula` may be turned off for Anki users (Anki doesn't evaluate
 * formulas — the leading apostrophe would leak into the card text).
 */
function cardsToCsv(cards, { escapeFormula = true } = {}) {
    const lines = ["Front,Back,Deck"];
    for (const c of cards) {
        lines.push([
            csvCell(c.front, { escapeFormula }),
            csvCell(c.back, { escapeFormula }),
            csvCell(c.deckName, { escapeFormula }),
        ].join(","));
    }
    return lines.join("\r\n");
}

const ISO = (d) => (d ? new Date(d).toISOString().replace("T", " ").slice(0, 16) + "Z" : "");

/**
 * Chat → Markdown. Citations become numbered footnotes; flagged sources are
 * marked. Trace is summarized (tool, ok, ms) rather than dumped raw.
 */
function chatToMarkdown(chat) {
    const lines = [
        `# ${chat.title || "Chat export"}`,
        "",
        `_Exported ${ISO(new Date())} · Chat created ${ISO(chat.createdAt)} · ${chat.messages.length} messages_`,
        "",
        "---",
        "",
    ];
    const footnotes = [];
    for (const m of chat.messages) {
        const who = m.role === "user" ? "**You**" : "**Quantum**";
        const when = m.timestamp ? ` _(${ISO(m.timestamp)})_` : "";
        lines.push(`${who}${when}:`, "");
        lines.push(m.content || "", "");
        if (m.usedMemories?.length) {
            lines.push(`> _Personalized from ${m.usedMemories.length} saved ${m.usedMemories.length === 1 ? "memory" : "memories"}_`, "");
        }
        if (m.sources?.length) {
            for (const s of m.sources) {
                footnotes.push(s);
                const where = s.startSec != null ? `${Math.floor(s.startSec / 60)}:${String(Math.floor(s.startSec % 60)).padStart(2, "0")}` : s.page ? `p.${s.page}` : "";
                const flag = s.flagged ? " ⚠️ _instruction-like text — treated as data only_" : "";
                lines.push(`> [^${footnotes.length}] ${s.originalName || "source"}${where ? ` ${where}` : ""}${flag}`);
            }
            lines.push("");
        }
        if (m.trace?.length) {
            lines.push("> Agent trace: " + m.trace.map((t) => `\`${t.tool}\`(${t.ok === false ? "failed" : "ok"}${t.ms != null ? `, ${t.ms}ms` : ""})`).join(" → "), "");
        }
        if (m.truncated) lines.push("> _partial answer — generation stopped_", "");
    }
    return lines.join("\n");
}

module.exports = { csvCell, cardsToCsv, chatToMarkdown };
