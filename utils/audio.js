/**
 * utils/audio.js — audio ingestion helpers.
 *  - magic-byte / MIME sniffing (never trust the filename)
 *  - server-side duration via music-metadata (ESM, loaded dynamically)
 *  - structured transcript grouping (~1000-char chunks with time metadata)
 */
const mm = () => import("music-metadata");

const AUDIO_MAX_BYTES = () => parseInt(process.env.AUDIO_MAX_MB || "25") * 1024 * 1024;
const AUDIO_MAX_SEC = () => parseFloat(process.env.AUDIO_MAX_MIN || "30") * 60;
const AUDIO_FEATURE = () => process.env.FEATURE_AUDIO !== "false";

/** Map sniffed signatures -> canonical mime + extension. */
const SIGNATURES = [
    { mime: "audio/mpeg", ext: "mp3", test: (b) => b.length > 3 && (b.slice(0, 3).toString() === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) },
    { mime: "audio/wav", ext: "wav", test: (b) => b.length > 12 && b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WAVE" },
    { mime: "audio/ogg", ext: "ogg", test: (b) => b.length > 4 && b.slice(0, 4).toString() === "OggS" },
    { mime: "audio/flac", ext: "flac", test: (b) => b.length > 4 && b.slice(0, 4).toString() === "fLaC" },
    // m4a / mp4-audio: "ftyp" box at offset 4; brands M4A / M4B / isom / mp42 / mp41
    { mime: "audio/mp4", ext: "m4a", test: (b) => b.length > 12 && b.slice(4, 8).toString() === "ftyp" && /M4A|M4B|isom|mp4/i.test(b.slice(8, 32).toString("latin1")) },
];

const ACCEPTED_MIMES = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/ogg", "audio/flac", "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/aac"]);

/**
 * Validate an upload's head bytes as audio (magic bytes live in the first
 * ~32 bytes — pass a prefix buffer, not the whole file).
 * Returns {mime, ext} when valid, or {error} describing the rejection.
 */
function sniffAudio(head, declaredMime, sizeBytes) {
    if (!AUDIO_FEATURE()) return { error: "Audio uploads are disabled" };
    const size = sizeBytes != null ? sizeBytes : head.length;
    if (size > AUDIO_MAX_BYTES()) {
        return { error: `Audio exceeds the ${Math.round(AUDIO_MAX_BYTES() / 1024 / 1024)}MB limit` };
    }
    const hit = SIGNATURES.find((s) => s.test(head));
    if (!hit) {
        // Allow declared-audio mimes only when the bytes look like a media container
        return { error: "Unsupported audio format — use mp3, m4a, wav, ogg or flac" };
    }
    return hit;
}

function isAudioMime(mime) {
    return ACCEPTED_MIMES.has((mime || "").toLowerCase());
}

/** Duration in seconds (float) or null when unparsable. */
async function durationSec(buffer, mime) {
    try {
        const { parseBuffer } = await mm();
        const meta = await parseBuffer(buffer, { mimeType: mime });
        return meta?.format?.duration || null;
    } catch {
        return null;
    }
}

/** Duration from a file path — streams, never buffers the file in RAM. */
async function durationSecFromFile(filePath, mime) {
    try {
        const { parseFile } = await mm();
        const meta = await parseFile(filePath, { mimeType: mime });
        return meta?.format?.duration || null;
    } catch {
        return null;
    }
}

/**
 * Group transcript segments [{startSec,endSec,speaker,text}] into ~1000-char
 * chunks carrying metadata.startSec/endSec/speakers. Returns chunker-compatible
 * [{pageContent, metadata}] docs.
 */
function mmss(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function transcriptToDocs(segments, { target = 1000 } = {}) {
    const docs = [];
    let cur = { texts: [], startSec: null, endSec: null, speakers: new Set(), len: 0 };
    const flush = () => {
        if (!cur.texts.length) return;
        const prefix = (t) => `[${mmss(t.startSec)}]${t.speaker ? ` ${t.speaker}:` : ""} `;
        docs.push({
            pageContent: cur.texts.map((t) => prefix(t) + t.text).join("\n"),
            metadata: {
                startSec: cur.startSec,
                endSec: cur.endSec,
                speakers: [...cur.speakers],
            },
        });
        cur = { texts: [], startSec: null, endSec: null, speakers: new Set(), len: 0 };
    };
    for (const seg of segments || []) {
        const start = typeof seg.startSec === "number" ? seg.startSec : cur.endSec ?? 0;
        const end = typeof seg.endSec === "number" ? seg.endSec : start;
        const pieceLen = (seg.speaker ? seg.speaker.length + 10 : 0) + (seg.text || "").length;
        if (cur.len + pieceLen > target && cur.texts.length) flush();
        if (cur.startSec == null) cur.startSec = start;
        cur.endSec = Math.max(cur.endSec ?? end, end);
        if (seg.speaker) cur.speakers.add(seg.speaker);
        cur.texts.push({ speaker: seg.speaker, text: seg.text || "", startSec: start });
        cur.len += pieceLen;
    }
    flush();
    return docs;
}

module.exports = { sniffAudio, isAudioMime, durationSec, durationSecFromFile, transcriptToDocs, mmss, AUDIO_MAX_BYTES, AUDIO_MAX_SEC, AUDIO_FEATURE };
