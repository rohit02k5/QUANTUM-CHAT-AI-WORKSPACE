/**
 * utils/deepAnalysis.js — user-triggered PDF deep analysis (Phase 3B.3).
 *
 * A "deep-analysis" IngestionJob slices the requested page range into ~5-page
 * windows with pdf-lib, sends each slice to Gemini for structured page
 * analysis, and stores figure/chart/table pages as type:"figure" chunks
 * (scanned_text becomes normal text chunks). Windows checkpoint into
 * job.state.deepAnalysis so a restart never redoes finished work.
 */
const { PDFDocument } = require("pdf-lib");
const IngestionJob = require("../models/IngestionJob");
const File = require("../models/File");
const Chunk = require("../models/Chunk");
const geminiHelper = require("./geminiHelper");
const gridfs = require("./gridfs");
const logger = require("./logger");

const env = {
    maxPages: () => Math.max(1, parseInt(process.env.MULTIMODAL_MAX_PAGES || "20", 10)),
    dailyCap: () => Math.max(1, parseInt(process.env.DEEP_ANALYSIS_DAILY_CAP || "3", 10)),
    windowPages: () => Math.max(1, parseInt(process.env.DEEP_ANALYSIS_WINDOW_PAGES || "5", 10)),
    inlineMax: () => parseFloat(process.env.AUDIO_INLINE_MAX_MB || "10") * 1024 * 1024,
};

const log = () => (logger.child ? logger.child({ module: "deepAnalysis" }) : logger);

/** Slice `file` pages [start..end] (1-based, inclusive) into a new PDF. */
async function slicePdf(buffer, start, end) {
    const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const total = src.getPageCount();
    const lo = Math.max(1, start);
    const hi = Math.min(end, total);
    const out = await PDFDocument.create();
    const pages = await out.copyPages(src, Array.from({ length: hi - lo + 1 }, (_, i) => lo - 1 + i));
    pages.forEach((p) => out.addPage(p));
    return Buffer.from(await out.save());
}

async function setStage(job, stage, progress) {
    job.stage = stage;
    if (progress != null) job.progress = progress;
    await job.save();
}

/**
 * Execute a claimed deep-analysis job.
 * job.state.deepAnalysis: {pageStart, pageEnd, doneWindows:[idx], items:[...]}
 */
async function runDeepAnalysis(job, file) {
    const state = job.state.deepAnalysis || {};
    const pageStart = state.pageStart || 1;
    const pageEnd = state.pageEnd || file.pageCount || 1;
    const winPages = env.windowPages();
    const windows = [];
    for (let p = pageStart; p <= pageEnd; p += winPages) {
        windows.push({ index: windows.length, start: p, end: Math.min(pageEnd, p + winPages - 1) });
    }

    job.state.deepAnalysis = { pageStart, pageEnd, doneWindows: state.doneWindows || [], items: state.items || [] };
    const da = job.state.deepAnalysis;
    job.markModified("state");

    const buffer = await gridfs.getBuffer(file.gridfsId).catch(async () => {
        // legacy disk fallback
        const fs = require("fs");
        const path = require("path");
        if (file.path && fs.existsSync(path.resolve(file.path))) return fs.readFileSync(path.resolve(file.path));
        throw new Error("file bytes not found");
    });

    let sliceFailed = false;
    for (const w of windows) {
        if (da.doneWindows.includes(w.index)) continue;
        await setStage(job, "describe", 10 + Math.round((da.doneWindows.length / windows.length) * 80));

        let pdfPart = null;
        let uploadedName = null;
        let pageOffset = w.start - 1;
        try {
            let slice;
            try {
                slice = await slicePdf(buffer, w.start, w.end);
            } catch (e) {
                // Fallback: whole PDF with the range stated in the prompt.
                // The model sees all pages; we only keep items inside the window.
                sliceFailed = true;
                pageOffset = 0;
                log().warn({ file: file._id.toString(), window: w.index, err: e.message }, "pdf slice failed — sending whole document");
                slice = buffer;
            }
            if (slice.length <= env.inlineMax()) {
                pdfPart = { inlineData: { mimeType: "application/pdf", data: slice.toString("base64") } };
            } else {
                const up = await geminiHelper.uploadMedia(slice, "application/pdf", "quantum-deep-analysis");
                uploadedName = up.name;
                pdfPart = { fileData: { fileUri: up.uri, mimeType: up.mimeType || "application/pdf" } };
            }
            const { items } = await geminiHelper.analyzePdfPages({
                mime: "application/pdf", mediaPart: pdfPart, pageOffset,
            });
            for (const it of items) {
                // Keep only pages inside the requested window (whole-doc fallback
                // returns items for every page).
                if (it.page >= w.start && it.page <= w.end) da.items.push(it);
            }
        } finally {
            if (uploadedName) await geminiHelper.deleteMedia(uploadedName);
        }

        da.doneWindows.push(w.index);
        job.markModified("state");
        job.progress = 10 + Math.round((da.doneWindows.length / windows.length) * 80);
        await job.save();
    }

    // Upsert chunks keyed (file, figure|text, page, idx) — reruns are idempotent
    await setStage(job, "embed", 90);
    let seq = 0;
    for (const item of da.items) {
        const isScanned = item.type === "scanned_text";
        const type = isScanned ? "text" : "figure";
        const text = isScanned
            ? `Page ${item.page} (scanned):\n${item.description}`
            : `${item.type === "chart" ? "Chart" : item.type === "table" ? "Table" : "Figure"} on page ${item.page}: ${item.description}${item.keyData ? `\nKey data: ${item.keyData}` : ""}`;
        const embedding = await geminiHelper.getEmbedding(text, { task: "document" });
        await Chunk.updateOne(
            { file: file._id, type, "metadata.page": item.page, "metadata.deepIdx": seq },
            {
                $set: {
                    user: file.user,
                    file: file._id,
                    text,
                    pageContent: text,
                    metadata: { page: item.page, totalPages: file.pageCount, deepIdx: seq, figureType: item.type },
                    embedding,
                    embeddingModel: geminiHelper.embeddingModel,
                    embeddingDims: embedding.length,
                    type,
                },
            },
            { upsert: true }
        );
        seq++;
    }
    // Prune figure chunks from earlier runs outside this result set
    await Chunk.deleteMany({
        file: file._id,
        type: "figure",
        "metadata.page": { $gte: pageStart, $lte: pageEnd },
        "metadata.deepIdx": { $gte: seq },
    });

    file.deepAnalyzedPages = [...new Set([...(file.deepAnalyzedPages || []), ...Array.from({ length: pageEnd - pageStart + 1 }, (_, i) => pageStart + i)])].sort((a, b) => a - b);
    file.status = "ready";
    await file.save();
    job.status = "done";
    job.progress = 100;
    job.error = undefined;
    await job.save();
    log().info({ jobId: job._id.toString(), file: file._id.toString(), items: da.items.length, sliceFailed }, "deep analysis done");
    return job;
}

// ---------------------------------------------------------------------------
// Endpoint helpers
// ---------------------------------------------------------------------------

let _ttlEnsured = false;
async function quotaColl() {
    const coll = require("mongoose").connection.collection("deepanalysisquotas");
    if (!_ttlEnsured) {
        _ttlEnsured = true;
        await coll.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {});
    }
    return coll;
}

/** Per-user daily deep-analysis counter (Mongo TTL — same pattern as web_search). */
async function checkDailyCap(userId) {
    const coll = await quotaColl();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const key = `${userId}:${today.toISOString().slice(0, 10)}`;
    const doc = await coll.findOneAndUpdate(
        { _id: key },
        { $setOnInsert: { count: 0, expireAt: new Date(today.getTime() + 2 * 86400000) } },
        { upsert: true, returnDocument: "after" }
    );
    const count = doc.value?.count ?? doc.count ?? 0;
    return { used: count, cap: env.dailyCap(), remaining: Math.max(0, env.dailyCap() - count) };
}

async function consumeDailyQuota(userId) {
    const coll = await quotaColl();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const key = `${userId}:${today.toISOString().slice(0, 10)}`;
    await coll.updateOne(
        { _id: key },
        { $inc: { count: 1 }, $setOnInsert: { expireAt: new Date(today.getTime() + 2 * 86400000) } },
        { upsert: true }
    );
}

module.exports = { runDeepAnalysis, checkDailyCap, consumeDailyQuota, env, slicePdf };
