/**
 * utils/gridfs.js — file bytes live in MongoDB GridFS (bucket "uploads"),
 * not on the local disk (Render's disk is ephemeral). Uses the mongoose
 * connection's native driver — no extra dependency.
 */
const mongoose = require("mongoose");
const { Readable } = require("stream");

let _bucket = null;
function bucket() {
    if (!_bucket) {
        if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
            throw new Error("gridfs: mongoose not connected");
        }
        _bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: "uploads" });
    }
    return _bucket;
}

/** Upload a Buffer, returns the new GridFS file's ObjectId. */
function saveBuffer(buffer, { filename = "file", contentType = "application/octet-stream", metadata = {} } = {}) {
    return new Promise((resolve, reject) => {
        const up = bucket().openUploadStream(filename, { contentType, metadata });
        up.on("error", reject);
        up.on("finish", () => resolve(up.id));
        Readable.from(buffer).pipe(up);
    });
}

function openDownloadStream(id, opts) {
    return bucket().openDownloadStream(new mongoose.Types.ObjectId(id), opts);
}

/** Stat a GridFS object → {length, uploadDate} or null. */
async function stat(id) {
    const rows = await mongoose.connection.db
        .collection("uploads.files")
        .find({ _id: new mongoose.Types.ObjectId(id) })
        .limit(1)
        .toArray();
    return rows[0] || null;
}

async function getBuffer(id) {
    const chunks = [];
    for await (const c of openDownloadStream(id)) chunks.push(c);
    return Buffer.concat(chunks);
}

async function remove(id) {
    if (!id) return;
    try {
        await bucket().delete(new mongoose.Types.ObjectId(id));
    } catch (e) {
        if (!/FileNotFound/i.test(e.message)) throw e;
    }
}

module.exports = { saveBuffer, openDownloadStream, stat, getBuffer, remove };
