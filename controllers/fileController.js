const File = require("../models/File");
const Chunk = require("../models/Chunk");
const IngestionJob = require("../models/IngestionJob");
const DataLoader = require("../utils/dataLoader");
const { recursiveSplitChunks } = require("../utils/chunker");
const geminiHelper = require("../utils/geminiHelper");
const gridfs = require("../utils/gridfs");
const audio = require("../utils/audio");
const jobRunner = require("../utils/jobRunner");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
dotenv.config();

const TEMP_FILE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const USER_STORAGE_MAX_BYTES = () => parseInt(process.env.USER_STORAGE_MAX_MB || "100") * 1024 * 1024;

// Delete a File doc, its GridFS blob, chunks and ingestion jobs (best-effort)
async function removeFileArtifacts(fileDoc) {
    try { await Chunk.deleteMany({ file: fileDoc._id }); } catch (e) { /* ignore */ }
    try { await IngestionJob.deleteMany({ file: fileDoc._id }); } catch (e) { /* ignore */ }
    if (fileDoc.gridfsId) {
        try { await gridfs.remove(fileDoc.gridfsId); } catch (e) { /* ignore */ }
    }
    try { await File.deleteOne({ _id: fileDoc._id }); } catch (e) { /* ignore */ }
    if (fileDoc.path) fs.promises.unlink(fileDoc.path).catch(() => {});
}

/** Per-user total stored bytes (File.size across their files). */
async function userStorageBytes(userId) {
    const rows = await File.aggregate([
        { $match: { user: userId } },
        { $group: { _id: null, total: { $sum: "$size" } } },
    ]);
    return rows[0]?.total || 0;
}

/** Move the multer temp file into GridFS and remove it from local disk. */
async function persistToGridFS(req, mimetype, userId) {
    const buffer = await fs.promises.readFile(req.file.path);
    const gridfsId = await gridfs.saveBuffer(buffer, {
        filename: req.file.originalname,
        contentType: mimetype,
        metadata: { user: String(userId), originalName: req.file.originalname },
    });
    fs.promises.unlink(req.file.path).catch(() => {});
    return { gridfsId, buffer };
}

const jobPayload = (job) => ({
    id: job._id,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    attempts: job.attempts,
    error: job.error,
    file: job.file,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
});

// Upload File — stores bytes in GridFS, then queues an IngestionJob (202).
// INGEST_SYNC=true (and temp attachments) keep the old synchronous 201 shape.
exports.uploadFile = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "No file uploaded" });
        const { originalname, filename, mimetype, size } = req.file;
        const userId = req.user._id;
        const isTemp = req.body.isTemp === "true" || req.body.saveToKB === "false";

        // Per-user storage cap (M0's 512MB is shared)
        const cap = USER_STORAGE_MAX_BYTES();
        const used = await userStorageBytes(userId);
        if (used + size > cap) {
            fs.promises.unlink(req.file.path).catch(() => {});
            return res.status(413).json({
                message: `Storage limit reached — this upload would exceed your ${Math.round(cap / 1024 / 1024)}MB quota (using ${Math.round(used / 1024 / 1024)}MB).`,
            });
        }

        const isAudio = audio.isAudioMime(mimetype);

        // Documents keep the original 10MB cap (multer global limit is sized for audio)
        const DOC_MAX_BYTES = 10 * 1024 * 1024;
        if (!isAudio && size > DOC_MAX_BYTES) {
            fs.promises.unlink(req.file.path).catch(() => {});
            return res.status(413).json({ message: "File too large — documents are limited to 10MB" });
        }

        // Audio: magic-byte sniff + duration cap before storing anything
        let audioInfo = null;
        let audioDuration = null;
        if (isAudio) {
            const buffer = await fs.promises.readFile(req.file.path);
            audioInfo = audio.sniffAudio(buffer, mimetype);
            if (audioInfo.error) {
                fs.promises.unlink(req.file.path).catch(() => {});
                return res.status(400).json({ message: audioInfo.error });
            }
            audioDuration = await audio.durationSec(buffer, audioInfo.mime);
            const maxSec = audio.AUDIO_MAX_SEC();
            if (audioDuration && audioDuration > maxSec) {
                fs.promises.unlink(req.file.path).catch(() => {});
                return res.status(400).json({
                    message: `Audio is ${Math.round(audioDuration / 60)}min — the limit is ${Math.round(maxSec / 60)}min.`,
                });
            }
        } else if (mimetype.startsWith("audio/")) {
            // Declared audio but not a supported type
            fs.promises.unlink(req.file.path).catch(() => {});
            return res.status(400).json({ message: "Unsupported audio format — use mp3, m4a, wav, ogg or flac" });
        }

        // Temp attachments: extract synchronously (unchanged contract), but the
        // bytes still go to GridFS so deletion covers them.
        if (isTemp && !isAudio) {
            const { documents } = await DataLoader.load(req.file.path, mimetype);
            const { gridfsId } = await persistToGridFS(req, mimetype, userId);
            const newFile = await File.create({
                user: userId, filename, originalName: originalname,
                gridfsId, mimetype, size,
                content: documents.map((d) => d.pageContent).join("\n\n"),
                isTemp: true, kind: "doc", status: "ready",
            });
            return res.status(201).json({ message: "File attached (temporary)", file: newFile, indexed: false, chunkCount: 0 });
        }

        const { gridfsId, buffer } = await persistToGridFS(req, isAudio ? audioInfo.mime : mimetype, userId);

        try {
            const newFile = await File.create({
                user: userId, filename, originalName: originalname,
                gridfsId, mimetype: isAudio ? audioInfo.mime : mimetype, size,
                kind: isAudio ? "audio" : "doc",
                status: "processing",
                durationSec: audioDuration || undefined,
                isTemp,
            });
            const job = await IngestionJob.create({ user: userId, file: newFile._id });

            // Legacy sync path (tests / small-file back-compat)
            if (jobRunner.env.sync()) {
                job.status = "processing";
                job.lockedAt = new Date();
                job.attempts = 1;
                await job.save();
                try {
                    await jobRunner.processJob(job);
                    const doneFile = await File.findById(newFile._id);
                    const chunkCount = await Chunk.countDocuments({ file: newFile._id });
                    return res.status(201).json({
                        message: chunkCount > 0 ? "File ingested successfully" : "File saved, but indexing produced no chunks",
                        file: doneFile,
                        jobId: job._id,
                        indexed: chunkCount > 0,
                        chunkCount,
                    });
                } catch (e) {
                    await jobRunner.failOrRequeue(job, e);
                    return res.status(500).json({ message: "Ingestion failed: " + e.message, file: newFile, jobId: job._id });
                }
            }

            return res.status(202).json({
                message: "Upload accepted — ingestion queued",
                file: newFile,
                fileId: newFile._id,
                jobId: job._id,
            });
        } catch (e) {
            // Roll back the stored bytes if record creation failed
            await gridfs.remove(gridfsId).catch(() => {});
            throw e;
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Ingestion failed: " + err.message });
    }
};

// Get User Files — includes the latest ingestion job per file for the progress UI
exports.getUserFiles = async (req, res) => {
    try {
        const files = await File.find({ user: req.user._id }).sort({ uploadDate: -1 }).lean();
        const jobs = await IngestionJob.find({ file: { $in: files.map((f) => f._id) } })
            .sort({ createdAt: -1 })
            .lean();
        const latest = new Map();
        for (const j of jobs) {
            const k = j.file.toString();
            if (!latest.has(k)) latest.set(k, j);
        }
        for (const f of files) {
            const j = latest.get(f._id.toString());
            if (j) {
                f.job = {
                    id: j._id, status: j.status, stage: j.stage,
                    progress: j.progress, error: j.error,
                };
            }
        }
        res.status(200).json({ files });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// Search Files (Basic Implementation)
exports.searchFiles = async (req, res) => {
    try {
        const { query } = req.query;
        if (!query || typeof query !== "string") {
            return res.status(400).json({ message: "Query is required" });
        }
        const escaped = query.slice(0, 200).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const files = await File.find({
            user: req.user._id,
            originalName: { $regex: escaped, $options: "i" },
        });
        res.status(200).json({ results: files });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// View/Download a file — authenticated, ownership-checked, GridFS-backed with
// HTTP Range support (required for audio seeking).
exports.viewFile = async (req, res) => {
    try {
        const file = await File.findOne({ _id: req.params.fileId, user: req.user._id });
        if (!file) return res.status(404).json({ message: "File not found" });

        const contentType = file.mimetype || "application/octet-stream";
        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.originalName)}"`);
        res.setHeader("Accept-Ranges", "bytes");

        if (file.gridfsId) {
            const meta = await gridfs.stat(file.gridfsId);
            if (!meta) return res.status(404).json({ message: "File bytes missing" });
            const total = meta.length;

            const range = req.headers.range;
            if (range) {
                const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
                if (m) {
                    let start = m[1] ? parseInt(m[1], 10) : 0;
                    let end = m[2] ? parseInt(m[2], 10) : total - 1;
                    if (m[1] === "") { // suffix range: bytes=-N
                        start = Math.max(0, total - parseInt(m[2], 10));
                        end = total - 1;
                    }
                    if (Number.isNaN(start) || start >= total || start > end) {
                        res.setHeader("Content-Range", `bytes */${total}`);
                        return res.status(416).end();
                    }
                    end = Math.min(end, total - 1);
                    res.status(206);
                    res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
                    res.setHeader("Content-Length", end - start + 1);
                    return gridfs.openDownloadStream(file.gridfsId, { start, end: end + 1 }).pipe(res);
                }
            }
            res.setHeader("Content-Length", total);
            return gridfs.openDownloadStream(file.gridfsId).pipe(res);
        }

        // Legacy local-disk files (pre-GridFS records)
        const absPath = path.resolve(file.path || "");
        if (!file.path || !fs.existsSync(absPath)) {
            return res.status(404).json({ message: "File no longer exists on disk" });
        }
        const stat = fs.statSync(absPath);
        const range = req.headers.range;
        if (range) {
            const m = /^bytes=(\d+)-(\d*)$/.exec(range.trim());
            if (m) {
                const start = parseInt(m[1], 10);
                const end = Math.min(m[2] ? parseInt(m[2], 10) : stat.size - 1, stat.size - 1);
                if (start >= stat.size || start > end) {
                    res.setHeader("Content-Range", `bytes */${stat.size}`);
                    return res.status(416).end();
                }
                res.status(206);
                res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
                res.setHeader("Content-Length", end - start + 1);
                return fs.createReadStream(absPath, { start, end }).pipe(res);
            }
        }
        res.setHeader("Content-Length", stat.size);
        fs.createReadStream(absPath).pipe(res);
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// Delete File — File record, GridFS blob, chunks, and ingestion jobs
exports.deleteFile = async (req, res) => {
    try {
        const file = await File.findOne({ _id: req.params.fileId, user: req.user._id });
        if (!file) return res.status(404).json({ message: "File not found" });
        await removeFileArtifacts(file);
        res.status(200).json({ message: "File deleted" });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// ---------------------------------------------------------------------------
// Ingestion job APIs
// ---------------------------------------------------------------------------

// GET /api/v1/files/:fileId/ingestion/stream — SSE progress, owner-only
exports.streamIngestion = async (req, res) => {
    try {
        const file = await File.findOne({ _id: req.params.fileId, user: req.user._id });
        if (!file) return res.status(404).json({ message: "File not found" });
        const job = await IngestionJob.findOne({ file: file._id }).sort({ createdAt: -1 });
        if (!job) return res.status(404).json({ message: "No ingestion job for this file" });

        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
        });
        res.flushHeaders();

        const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
        send({ stage: job.stage, progress: job.progress, status: job.status, error: job.error });
        if (job.status === "done" || job.status === "failed") return res.end();

        const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);
        const poll = setInterval(async () => {
            try {
                const fresh = await IngestionJob.findById(job._id);
                if (!fresh) return cleanup();
                send({ stage: fresh.stage, progress: fresh.progress, status: fresh.status, error: fresh.error });
                if (fresh.status === "done" || fresh.status === "failed") cleanup();
            } catch { /* keep polling */ }
        }, 1000);

        function cleanup() {
            clearInterval(heartbeat);
            clearInterval(poll);
            res.end();
        }
        res.on("close", cleanup);
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// GET /api/v1/jobs/:id — polling fallback
exports.getJob = async (req, res) => {
    try {
        const job = await IngestionJob.findOne({ _id: req.params.id, user: req.user._id });
        if (!job) return res.status(404).json({ message: "Job not found" });
        res.status(200).json({ job: jobPayload(job) });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// POST /api/v1/jobs/:id/retry — requeue a failed job
exports.retryJob = async (req, res) => {
    try {
        const job = await IngestionJob.findOne({ _id: req.params.id, user: req.user._id });
        if (!job) return res.status(404).json({ message: "Job not found" });
        if (job.status !== "failed") {
            return res.status(400).json({ message: `Job is ${job.status} — only failed jobs can be retried` });
        }
        job.status = "queued";
        job.attempts = 0;
        job.error = undefined;
        job.lockedAt = undefined;
        job.state.nextSeq = 0; // keep transcript windows; re-verify chunks idempotently
        job.markModified("state");
        await job.save();
        await File.findByIdAndUpdate(job.file, { status: "processing" });
        res.status(200).json({ job: jobPayload(job) });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// Sweep stale temp files (uploaded but never cleaned up — e.g. attach without send)
exports.cleanupTempFiles = async (maxAgeMs = TEMP_FILE_TTL_MS) => {
    try {
        const cutoff = new Date(Date.now() - maxAgeMs);
        const stale = await File.find({ isTemp: true, uploadDate: { $lt: cutoff } });
        for (const f of stale) await removeFileArtifacts(f);
        if (stale.length) console.log(`[Files] Cleaned up ${stale.length} stale temp file(s)`);
    } catch (err) {
        console.error("[Files] Temp cleanup failed:", err.message);
    }
};

exports.removeFileArtifacts = removeFileArtifacts;
