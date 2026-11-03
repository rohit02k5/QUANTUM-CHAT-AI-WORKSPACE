const File = require("../models/File");
const Chunk = require("../models/Chunk");
const DataLoader = require("../utils/dataLoader");
const { recursiveSplitChunks } = require("../utils/chunker");
const geminiHelper = require("../utils/geminiHelper");
const fs = require("fs");
const dotenv = require("dotenv");
dotenv.config();

const DEFAULT_CHUNK_SIZE = 1000;
const DEFAULT_CHUNK_OVERLAP = 200;
const EMBED_CONCURRENCY = 5;
const TEMP_FILE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// Delete a File doc, its chunks, and the file on disk (best-effort)
async function removeFileArtifacts(fileDoc) {
    try { await Chunk.deleteMany({ file: fileDoc._id }); } catch (e) { /* ignore */ }
    try { await File.deleteOne({ _id: fileDoc._id }); } catch (e) { /* ignore */ }
    fs.promises.unlink(fileDoc.path).catch(() => {});
}

// Embed chunks in parallel batches so large files don't serialize N API calls
async function embedChunksBatched(chunkDocs, userId, fileId) {
    let created = 0;
    for (let i = 0; i < chunkDocs.length; i += EMBED_CONCURRENCY) {
        const batch = chunkDocs.slice(i, i + EMBED_CONCURRENCY);
        const results = await Promise.all(
            batch.map(async (cd) => {
                try {
                    const embedding = await geminiHelper.getEmbedding(cd.pageContent);
                    await Chunk.create({
                        user: userId,
                        file: fileId,
                        text: cd.pageContent,
                        pageContent: cd.pageContent,
                        metadata: cd.metadata,
                        embedding,
                    });
                    return true;
                } catch (err) {
                    console.error("[Ingest] Chunk embed failed:", err.message);
                    return false;
                }
            })
        );
        created += results.filter(Boolean).length;
    }
    return created;
}

// Upload File — document-based pipeline with metadata-forward chunks
exports.uploadFile = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "No file uploaded" });
        const { originalname, filename, path: filePath, mimetype, size } = req.file;
        const userId = req.user._id;

        // Temp files are used for a single message only — never indexed for RAG.
        // (ExecutiveAssistant already sends isTemp=true; Chat sends saveToKB.)
        const isTemp = req.body.isTemp === "true" || req.body.saveToKB === "false";

        // 1. Load into LangChain-style Documents (pageContent + metadata)
        const { documents } = await DataLoader.load(filePath, mimetype);

        // 2. Save File record with summary metadata + extracted text
        const newFile = new File({
            user: userId, filename, originalName: originalname,
            path: filePath, mimetype, size,
            content: documents.map(d => d.pageContent).join("\n\n"),
            isTemp,
        });
        await newFile.save();

        if (isTemp) {
            return res.status(201).json({ message: "File attached (temporary)", file: newFile, indexed: false, chunkCount: 0 });
        }

        // 3. RAG ingestion: split documents into overlapping chunks with metadata
        const userChunkDocs = recursiveSplitChunks(documents, {
            chunkSize: DEFAULT_CHUNK_SIZE,
            chunkOverlap: DEFAULT_CHUNK_OVERLAP,
        });

        const chunkCount = await embedChunksBatched(userChunkDocs, userId, newFile._id);

        res.status(201).json({
            message: chunkCount > 0 ? "File ingested successfully" : "File saved, but indexing produced no chunks",
            file: newFile,
            indexed: chunkCount > 0,
            chunkCount,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Ingestion failed: " + err.message });
    }
};

// Get User Files
exports.getUserFiles = async (req, res) => {
    try {
        const files = await File.find({ user: req.user._id }).sort({ uploadDate: -1 });
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

// View/Download a file — authenticated, ownership-checked replacement for
// the old public /uploads static route.
exports.viewFile = async (req, res) => {
    try {
        const file = await File.findOne({ _id: req.params.fileId, user: req.user._id });
        if (!file) return res.status(404).json({ message: "File not found" });

        const fs = require("fs");
        const path = require("path");
        const absPath = path.resolve(file.path);
        if (!fs.existsSync(absPath)) return res.status(404).json({ message: "File no longer exists on disk" });

        res.setHeader("Content-Type", file.mimetype || "application/octet-stream");
        res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.originalName)}"`);
        fs.createReadStream(absPath).pipe(res);
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// Delete File — removes the File record, all its chunks, and the file on disk
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
