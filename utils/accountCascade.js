/**
 * utils/accountCascade.js — registry of EVERY artifact owned by a user.
 *
 * DELETE /api/v1/auth/account deletes through this registry only. A test
 * iterates every Mongoose model and FAILS if a model declaring a `user`
 * path is not registered here — Phase 5+ models can't be silently skipped.
 *
 * Entry shapes:
 *   { model: "Name" }                        — deleteMany({user: uid}); the
 *                                              collection comes from the model
 *   { collection: "name", query: (uid)=>{} } — user data in a model-less
 *                                              collection (custom keys)
 *   { gridfs: true }                         — also delete file.gridfsId blobs
 */
const mongoose = require("mongoose");

const CASCADE = [
    { model: "File", gridfs: true },
    { model: "Chunk" },
    { model: "IngestionJob" },
    { model: "Chat" },
    { model: "Persona" },
    { model: "FlashcardSet" },
    { model: "UsageEvent" },
    { model: "WebSearchQuota" },
    { model: "RerankCache" }, // Phase 4.3 — model may not exist yet; skipped
    // TTL-backed daily quota docs keyed `${userId}:${YYYY-MM-DD}` (no model)
    { collection: "deepanalysisquotas", query: (uid) => ({ _id: new RegExp(`^${uid}:`) }) },
    // Account-deletion confirmation tokens keyed by user _id (no model)
    { collection: "deletionconfirms", query: (uid) => ({ _id: uid }) },
];

/** Registered model names — the registry test checks schema.user coverage. */
function registeredModels() {
    return CASCADE.filter((e) => e.model).map((e) => e.model);
}

/** True for every Mongoose model whose schema has a `user` path. */
function userOwnedModels() {
    return Object.values(mongoose.models).filter((m) => {
        try { return !!m.schema?.path("user"); } catch { return false; }
    });
}

/**
 * Delete everything the user owns. Returns {collectionName: deletedCount}.
 * GridFS blobs for owned File docs are removed first.
 */
async function cascadeDelete(uid) {
    const gridfs = require("./gridfs");
    const deleted = {};

    // GridFS blobs live behind File.gridfsId — delete before the File docs.
    const File = mongoose.models.File && mongoose.model("File");
    if (File) {
        const files = await File.find({ user: uid }).select("_id gridfsId").lean();
        let blobs = 0;
        await Promise.all(files.map((f) =>
            f.gridfsId ? gridfs.remove(f.gridfsId).then(() => { blobs++; }).catch(() => {}) : null
        ));
        deleted["fs.files"] = blobs;
    }

    for (const entry of CASCADE) {
        const coll = entry.model && mongoose.models[entry.model]
            ? mongoose.model(entry.model).collection
            : entry.collection
                ? mongoose.connection.collection(entry.collection)
                : null;
        if (!coll) continue;
        const query = entry.query ? entry.query(uid) : { user: uid };
        const res = await coll.deleteMany(query);
        deleted[entry.model || entry.collection] = res.deletedCount || 0;
    }
    return deleted;
}

module.exports = { CASCADE, cascadeDelete, registeredModels, userOwnedModels };
