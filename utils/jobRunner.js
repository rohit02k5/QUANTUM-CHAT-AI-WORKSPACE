/**
 * utils/jobRunner.js — in-process, resumable ingestion runner.
 *
 * Uploads are queued as IngestionJob docs; the runner polls Mongo, claims one
 * job atomically (findOneAndUpdate queued->processing), and drives it through
 * extract|transcribe -> chunk -> embed -> index. Progress is persisted per
 * stage so a crashed job resumes at its checkpoint instead of restarting:
 *   - embed resumes at job.state.nextSeq (chunks upsert by (file, seq))
 *   - transcribe resumes per time-window (job.state.audio.doneWindows)
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const mongoose = require("mongoose");
const IngestionJob = require("../models/IngestionJob");
const File = require("../models/File");
const Chunk = require("../models/Chunk");
const DataLoader = require("./dataLoader");
const { recursiveSplitChunks } = require("./chunker");
const geminiHelper = require("./geminiHelper");
const gridfs = require("./gridfs");
const audio = require("./audio");
const logger = require("./logger");

const env = {
    sync: () => process.env.INGEST_SYNC === "true",
    concurrency: () => Math.max(1, parseInt(process.env.INGEST_CONCURRENCY || "1", 10)),
    pollMs: () => parseInt(process.env.INGEST_POLL_MS || "3000", 10),
    staleMs: () => parseInt(process.env.INGEST_STALE_MS || "120000", 10),
    maxAttempts: () => parseInt(process.env.INGEST_MAX_ATTEMPTS || "3", 10),
    embedBatch: () => Math.max(1, parseInt(process.env.INGEST_EMBED_BATCH || "8", 10)),
    audioSegmentSec: () => Math.max(30, parseInt(process.env.AUDIO_SEGMENT_SEC || "600", 10)),
};

const log = () => logger.child ? logger.child({ module: "jobRunner" }) : logger;

const isTransient = (e) =>
    e?.status === 429 || (e?.status >= 500 && e?.status < 600) || /Overloaded|rate limit|RESOURCE_EXHAUSTED/i.test(e?.message || "");

// Daily-quota errors must not be retried inside the pipeline — the job is
// requeued with a notBefore delay instead (failOrRequeue).
const isDailyQuota = (e) => geminiHelper.classifyError(e).kind === "daily-quota";

// How long to wait when the API doesn't tell us. Free-tier daily quotas reset
// within hours; 15 min keeps the queue responsive without hammering.
const QUOTA_WAIT_DEFAULT_MS = parseInt(process.env.QUOTA_WAIT_MS || String(15 * 60 * 1000), 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fetch the raw bytes of a stored file (GridFS first, legacy disk fallback). */
async function getFileBytes(file) {
    if (file.gridfsId) return gridfs.getBuffer(file.gridfsId);
    if (file.path && fs.existsSync(path.resolve(file.path))) {
        return fs.readFileSync(path.resolve(file.path));
    }
    throw new Error("file bytes not found in GridFS or on disk");
}

async function setStage(job, stage, progress) {
    job.stage = stage;
    if (progress != null) job.progress = progress;
    await job.save();
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

async function extractDocs(file, buffer) {
    const ext = path.extname(file.originalName || "") || ".bin";
    const tmp = path.join(os.tmpdir(), `ingest-${file._id}-${Date.now()}${ext}`);
    // Stream GridFS -> tmp when possible so large docs never sit in RAM whole.
    if (file.gridfsId) {
        await new Promise((resolve, reject) => {
            const ws = fs.createWriteStream(tmp);
            gridfs.openDownloadStream(file.gridfsId).on("error", reject).pipe(ws);
            ws.on("error", reject).on("finish", resolve);
        });
    } else {
        fs.writeFileSync(tmp, buffer || (await getFileBytes(file)));
    }
    try {
        const res = await DataLoader.load(tmp, file.mimetype);
        return res;
    } finally {
        fs.unlink(tmp, () => {});
    }
}

/**
 * Transcribe audio, resumable per time-window. Finished windows are persisted
 * on job.state.audio so a restarted job never re-transcribes them.
 */
async function transcribeResumable(job, buffer, file, durationSec) {
    const winSec = env.audioSegmentSec();
    const windows = durationSec && durationSec > winSec
        ? Array.from({ length: Math.ceil(durationSec / winSec) }, (_, i) => ({
            index: i, startSec: i * winSec, endSec: Math.min(durationSec, (i + 1) * winSec),
        }))
        : [{ index: 0, startSec: 0, endSec: durationSec || 0, full: true }];

    job.state.audio = job.state.audio || { doneWindows: [], segments: [] };
    const audioState = job.state.audio;

    for (const w of windows) {
        if (audioState.doneWindows.includes(w.index)) continue;
        const { segments } = await geminiHelper.transcribeAudio(buffer, {
            mime: file.mimetype,
            window: w.full ? null : { startSec: w.startSec, endSec: w.endSec },
        });
        audioState.segments.push(...(segments || []));
        audioState.doneWindows.push(w.index);
        job.markModified("state");
        job.progress = 10 + Math.round((audioState.doneWindows.length / windows.length) * 40);
        await job.save();
    }

    return audioState.segments
        .filter((s) => s && typeof s.text === "string" && s.text.trim())
        .sort((a, b) => (a.startSec || 0) - (b.startSec || 0));
}

async function embedBatchWithBackoff(texts, userId = null) {
    // Per-user EmbeddingCache (Phase 6B): texts already embedded under the
    // active profile reuse the stored vector instead of a live API call.
    const ec = require("./embeddingCache");
    const profile = { model: geminiHelper.embeddingModel, dims: geminiHelper.EMBEDDING_DIMS || 768, taskType: "document" };
    const hits = userId ? await ec.lookup(userId, texts, profile) : new Map();
    const fresh = [];
    const out = new Array(texts.length);
    texts.forEach((t, i) => {
        if (hits.has(i)) out[i] = hits.get(i);
        else fresh.push({ i, t });
    });
    for (const { i, t } of fresh) {
        let attempt = 0;
        for (;;) {
            try {
                out[i] = await geminiHelper.getEmbedding(t, { task: "document" });
                break;
            } catch (e) {
                if (isDailyQuota(e)) throw e; // no point retrying — requeued by failOrRequeue
                if (isTransient(e) && attempt < 3) {
                    await sleep(Math.min(1000 * 2 ** attempt, 10000));
                    attempt++;
                    continue;
                }
                throw e;
            }
        }
    }
    if (userId && fresh.length) {
        ec.store(userId, fresh.map(({ i, t }) => ({ text: t, vector: out[i] })).filter((e) => e.vector), profile)
            .catch(() => {});
    }
    return out;
}

/** Execute the full pipeline for one claimed (status=processing) job. */
async function processJob(job) {
    const file = await File.findById(job.file);
    if (!file) throw new Error("file no longer exists");

    if (job.kind === "deep-analysis") {
        const { runDeepAnalysis } = require("./deepAnalysis");
        return runDeepAnalysis(job, file);
    }

    file.status = "processing";
    await file.save();

    // Reprocess regenerates TEXT chunks — stale ones are pruned AFTER the new
    // embeds upsert (seq >= new count), so a failed reprocess keeps old chunks.
    // Figure/image chunks are keyed separately and never touched.

    // Bytes are fetched lazily — docs stream GridFS->tmp in extractDocs; audio
    // and images need the whole buffer (Gemini inline part / Files API upload).
    const buffer = file.kind === "audio" || file.kind === "image" ? await getFileBytes(file) : null;
    let docs;

    if (file.kind === "image") {
        await setStage(job, "describe", 20);
        const { descriptionToDocs } = require("./image");
        const desc = await geminiHelper.describeImage(buffer, { mime: file.mimetype });
        file.description = { caption: desc.caption, ocrText: desc.ocrText, dataInsights: desc.dataInsights, tags: desc.tags };
        file.content = [desc.caption, desc.ocrText, desc.dataInsights].filter(Boolean).join("\n\n");
        docs = descriptionToDocs(desc, file.originalName);
        docs.forEach((d) => { d.metadata.type = "image"; });
        await setStage(job, "chunk", 55);
    } else if (file.kind === "audio") {
        await setStage(job, "transcribe", 10);
        const duration = file.durationSec ?? (await audio.durationSec(buffer, file.mimetype));
        if (duration) { file.durationSec = duration; }
        const segments = await transcribeResumable(job, buffer, file, duration);
        file.content = segments
            .map((s) => `[${audio.mmss(s.startSec)}]${s.speaker ? ` ${s.speaker}:` : ""} ${s.text}`)
            .join("\n");
        docs = audio.transcriptToDocs(segments, { target: 1000 });
        await setStage(job, "chunk", 55);
    } else {
        await setStage(job, "extract", 10);
        const res = await extractDocs(file, buffer);
        docs = res.documents;
        file.content = docs.map((d) => d.pageContent).join("\n\n");
        // PDF page awareness — scanned pages get a UI hint + Deep analysis offer
        if (file.mimetype === "application/pdf") {
            file.pageCount = res.totalPages || docs.length || undefined;
            file.pagesWithoutText = res.pagesWithoutText?.length ? res.pagesWithoutText : undefined;
            file.pageIndexed = true;
        }
        // CSV column profile for the table analyst — streamed, capped at
        // TABLE_MAX_ROWS. Failure here must not fail ingestion.
        if (/csv|ms-excel/i.test(file.mimetype || "")) {
            try {
                const tableQuery = require("../services/tableQuery");
                const tmpCsv = await tableQuery.csvToTemp(file);
                try {
                    file.tableMeta = await tableQuery.computeTableMeta(tmpCsv);
                } finally {
                    fs.unlink(tmpCsv, () => {});
                }
            } catch (e) {
                log().warn({ err: e.message, file: file._id.toString() }, "tableMeta profiling failed — RAG chunks unaffected");
            }
        }
        await setStage(job, "chunk", 40);
    }

    if (!docs.length) throw new Error("no text could be extracted from this file");
    await file.save();

    // Image descriptions are already chunk-sized docs; text pipelines split.
    const chunkDocs = file.kind === "image"
        ? docs
        : recursiveSplitChunks(docs, { chunkSize: 1000, chunkOverlap: 200 });
    chunkDocs.forEach((c, i) => { c.metadata.seq = i; });
    const chunkType = file.kind === "image" ? "image" : "text";

    // Embed + upsert — resumes at job.state.nextSeq; upserts make it idempotent
    await setStage(job, "embed", Math.max(job.progress, 50));
    const batch = env.embedBatch();
    let seq = job.state.nextSeq || 0;
    for (; seq < chunkDocs.length; seq += batch) {
        const slice = chunkDocs.slice(seq, seq + batch);
        const vectors = await embedBatchWithBackoff(slice.map((c) => c.pageContent), file.user);
        await Promise.all(slice.map((cd, i) => {
            const emb = vectors[i];
            return Chunk.updateOne(
                { file: file._id, "metadata.seq": cd.metadata.seq },
                {
                    $set: {
                        user: file.user,
                        file: file._id,
                        text: cd.pageContent,
                        pageContent: cd.pageContent,
                        metadata: cd.metadata,
                        embedding: emb,
                        embeddingModel: geminiHelper.embeddingModel,
                        embeddingDims: emb.length,
                        type: chunkType,
                    },
                },
                { upsert: true }
            );
        }));
        job.state.nextSeq = seq + slice.length;
        job.markModified("state");
        job.progress = 50 + Math.round((job.state.nextSeq / chunkDocs.length) * 45);
        await job.save();
    }

    if (job.kind === "reprocess") {
        await Chunk.deleteMany({
            file: file._id,
            $or: [{ type: "text" }, { type: { $exists: false } }],
            "metadata.seq": { $gte: chunkDocs.length },
        });
    }

    await setStage(job, "index", 96);
    file.status = "ready";
    await file.save();
    job.status = "done";
    job.progress = 100;
    job.error = undefined;
    await job.save();
    log().info({ jobId: job._id.toString(), fileId: file._id.toString(), chunks: chunkDocs.length }, "ingestion done");
    return job;
}

/** Failure handling: requeue until max attempts, then mark failed. Daily
 *  AI-quota failures are NOT failures — the job waits for the quota window
 *  (notBefore) and attempts are left untouched (undo the claim increment). */
async function failOrRequeue(job, err) {
    const cls = geminiHelper.classifyError(err);
    if (cls.kind === "daily-quota") {
        job.status = "queued";
        job.lockedAt = undefined;
        job.attempts = Math.max(0, job.attempts - 1); // undo the claim increment
        job.notBefore = new Date(Date.now() + (cls.retryAfterMs || QUOTA_WAIT_DEFAULT_MS));
        job.error = "Waiting for AI quota";
        await job.save();
        log().info({ jobId: job._id.toString(), notBefore: job.notBefore }, "ingestion paused — waiting for AI quota");
        return job;
    }
    job.error = (err?.message || "ingestion failed").slice(0, 500);
    if (job.attempts >= env.maxAttempts()) {
        job.status = "failed";
        await File.findByIdAndUpdate(job.file, { status: "failed" }).catch(() => {});
        log().warn({ jobId: job._id.toString(), err: job.error, attempts: job.attempts }, "ingestion failed permanently");
    } else {
        job.status = "queued";
        job.lockedAt = undefined;
        log().warn({ jobId: job._id.toString(), err: job.error, attempts: job.attempts }, "ingestion failed — requeued");
    }
    await job.save();
    return job;
}

// ---------------------------------------------------------------------------
// Runner loop
// ---------------------------------------------------------------------------

const runner = { timer: null, stopping: false, active: new Set() };

async function claimNext() {
    const now = new Date();
    return IngestionJob.findOneAndUpdate(
        { status: "queued", $or: [{ notBefore: null }, { notBefore: { $lte: now } }] },
        { $set: { status: "processing", lockedAt: now }, $unset: { notBefore: 1 }, $inc: { attempts: 1 } },
        { sort: { createdAt: 1 }, new: true }
    );
}

async function tick() {
    if (runner.stopping) return;
    if (mongoose.connection.readyState !== 1) return;
    while (runner.active.size < env.concurrency()) {
        const job = await claimNext();
        if (!job) return;
        runner.active.add(job._id.toString());
        (async () => {
            try {
                await processJob(job);
            } catch (e) {
                await failOrRequeue(job, e);
            } finally {
                runner.active.delete(job._id.toString());
            }
        })().catch(() => {});
    }
}

/** Requeue processing jobs whose lock went stale (crashed runner). */
async function requeueStale() {
    const staleBefore = new Date(Date.now() - env.staleMs());
    const stale = await IngestionJob.find({ status: "processing", lockedAt: { $lt: staleBefore } });
    for (const j of stale) {
        if (j.attempts >= env.maxAttempts()) {
            j.status = "failed";
            j.error = "ingestion timed out too many times";
            await File.findByIdAndUpdate(j.file, { status: "failed" }).catch(() => {});
        } else {
            j.status = "queued";
            j.lockedAt = undefined;
        }
        await j.save();
    }
    return stale.length;
}

function startRunner() {
    if (runner.timer || env.sync()) return runner;
    runner.stopping = false;
    runner.timer = setInterval(() => tick().catch(() => {}), env.pollMs());
    runner.timer.unref?.();
    tick().catch(() => {});
    log().info({ pollMs: env.pollMs(), concurrency: env.concurrency() }, "ingestion runner started");
    return runner;
}

/** Graceful stop: no new claims; in-flight jobs released back to queued. */
async function stopRunner() {
    runner.stopping = true;
    if (runner.timer) { clearInterval(runner.timer); runner.timer = null; }
    for (const id of runner.active) {
        await IngestionJob.updateOne(
            { _id: id, status: "processing" },
            { $set: { status: "queued" }, $unset: { lockedAt: 1 } }
        ).catch(() => {});
    }
    runner.active.clear();
}

module.exports = {
    startRunner,
    stopRunner,
    requeueStale,
    processJob,
    failOrRequeue,
    claimNext,
    runner, // exposed for tests/shutdown verification
    getFileBytes,
    runner,
    env,
};
