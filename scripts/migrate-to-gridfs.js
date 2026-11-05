/**
 * scripts/migrate-to-gridfs.js — move legacy local-disk uploads into GridFS.
 *
 *   node scripts/migrate-to-gridfs.js [--dry-run]
 *
 * - Idempotent & resumable: a file is considered migrated when its File doc
 *   has a gridfsId, so reruns skip finished files.
 * - The local file is only deleted AFTER the GridFS copy is verified by
 *   byte length (and a read-back re-check).
 * - Logs one line per file.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const File = require("../models/File");
const gridfs = require("../utils/gridfs");

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
    await connectDB();
    // Wait for the connection to be usable
    if (mongoose.connection.readyState !== 1) {
        await new Promise((r) => mongoose.connection.once("open", r));
    }

    const legacy = await File.find({ gridfsId: { $exists: false }, path: { $exists: true, $ne: null } });
    console.log(`[migrate] ${legacy.length} file(s) with local-disk bytes${DRY_RUN ? " — DRY RUN" : ""}`);

    let migrated = 0, missing = 0, failed = 0, skipped = 0;
    for (const f of legacy) {
        const abs = path.resolve(f.path || "");
        const tag = `${f._id} ${f.originalName}`;

        if (!f.path || !fs.existsSync(abs)) {
            console.log(`  SKIP  ${tag} — no local file at ${f.path || "(none)"}`);
            skipped++;
            continue;
        }
        const size = fs.statSync(abs).size;
        if (DRY_RUN) {
            console.log(`  DRY   ${tag} — would upload ${size} bytes`);
            migrated++;
            continue;
        }
        try {
            const buffer = await fs.promises.readFile(abs);
            const gridfsId = await gridfs.saveBuffer(buffer, {
                filename: f.originalName,
                contentType: f.mimetype || "application/octet-stream",
                metadata: { user: String(f.user), originalName: f.originalName, migrated: true },
            });
            // Verify: byte length in GridFS must match
            const stat = await gridfs.stat(gridfsId);
            if (!stat || stat.length !== size) {
                await gridfs.remove(gridfsId).catch(() => {});
                console.log(`  FAIL  ${tag} — length mismatch (local ${size} vs gridfs ${stat?.length})`);
                failed++;
                continue;
            }
            f.gridfsId = gridfsId;
            await f.save();
            await fs.promises.unlink(abs).catch(() => {});
            console.log(`  OK    ${tag} — ${size} bytes → gridfs ${gridfsId}`);
            migrated++;
        } catch (e) {
            console.log(`  FAIL  ${tag} — ${e.message}`);
            failed++;
        }
    }
    console.log(`[migrate] done: ${migrated} migrated, ${skipped} skipped (missing file), ${failed} failed`);
    await mongoose.disconnect();
}

main().catch((e) => { console.error("[migrate] fatal:", e.message); process.exit(1); });
