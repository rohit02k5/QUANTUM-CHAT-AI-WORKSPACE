// Atlas verification checklist for Phase 3B, run against the real cluster on
// database "quantum_ai_eval" with a throwaway user that is deleted at the end.
// Usage: node scripts/atlas-verify-3b.js
// Requires MONGO_URI + GEMINI_API_KEY in the environment. Never prints secrets.
// Generation-dependent steps report SKIP when the Gemini quota is exhausted —
// a SKIP is an infrastructure limitation, not a product failure.
require("dotenv").config();
const request = require("supertest");
const mongoose = require("mongoose");

process.env.INGEST_SYNC = "true";
const app = require("../app");
const { bucket } = require("../utils/gridfs");
const EVAL_DB = process.env.EVAL_MONGO_DB || "quantum_ai_eval";

const results = [];
let quotaExhausted = false; // set once a step proves the daily generate quota is out
const quotaSkip = (name, err) => {
    const quota = quotaExhausted || /429|503|quota|RESOURCE_EXHAUSTED|rate.?limit/i.test(String(err?.message || err));
    if (quota) quotaExhausted = true;
    results.push(`${quota ? "SKIP " : "FAIL "}${name}${quota ? " — Gemini quota exhausted, re-run after reset" : ": " + (err?.message || err)}`);
    return quota;
};

const step = (name, ok, detail = "") =>
    results.push(`${ok ? "PASS " : "FAIL "}${name}${detail ? " — " + detail : ""}`);

async function main() {
    const uri = process.env.MONGO_URI;
    if (!uri) { console.error("Set MONGO_URI"); process.exit(1); }
    await mongoose.connect(uri, { dbName: EVAL_DB });
    console.log(`connected to ${mongoose.connection.host} db=${EVAL_DB}`);
    const t = `atlas-${Date.now()}`;
    let token;
    const res = await request(app).post("/api/v1/auth/register")
        .send({ username: "atlas-verify", email: `${t}@t.com`, password: "AtlasVerify1!" });
    token = res.body?.token;
    step("register throwaway user", !!token);
    const auth = { Authorization: `Bearer ${token}` };
    const userModel = require("../models/userModel");
    const userId = (await userModel.findOne({ email: `${t}@t.com` }))?._id;
    const db = mongoose.connection.db;
    const File = require("../models/File");
    const Chunk = require("../models/Chunk");

    // Preflight: is the Gemini generate quota usable? One cheap call decides
    // whether generation-dependent steps run or honestly report SKIP.
    try {
        const gem = require("../utils/geminiHelper");
        await gem.generateContentWithRetry("Reply with the single word OK.", {}, 1, "chat");
        results.push("INFO gemini generate quota: available");
    } catch (e) {
        quotaExhausted = /429|503|quota|RESOURCE_EXHAUSTED/i.test(String(e?.message || e));
        results.push(`INFO gemini generate quota: ${quotaExhausted ? "exhausted — generation steps will SKIP" : "error: " + e.message}`);
    }

    try {
        // 1. Multi-page PDF → page metadata, p.N citation
        const pdf = require("fs").readFileSync(__dirname + "/../evals/fixtures/pages.pdf");
        const up = await request(app).post("/api/v1/files/upload")
            .set(auth).attach("file", Buffer.from(pdf), { filename: "pages.pdf", contentType: "application/pdf" });
        step("upload 5-page PDF", up.status === 202 || up.status === 201, `status ${up.status}`);
        const pdfFile = await File.findById(up.body?.fileId || up.body?.file?._id);
        step("pageCount = 5", pdfFile?.pageCount === 5, `got ${pdfFile?.pageCount}`);
        step("page chunks carry metadata.page", (await Chunk.countDocuments({ file: pdfFile._id, "metadata.page": { $exists: true } })) > 0);
        // Atlas vector indexes are eventually consistent — retry like the smoke test
        if (quotaExhausted) {
            quotaSkip("chat citation", "preflight");
        } else {
            let chat, lastErr;
            for (let i = 0; i < 5; i++) {
                if (i) await new Promise(r => setTimeout(r, 8000));
                chat = await request(app).post("/api/v1/chat/message")
                    .set(auth).send({ message: "What game is described on page 3? Answer briefly." });
                if (chat.status === 200 && chat.body?.sources?.length) break;
                lastErr = chat.body?.message || chat.body?.error || `status ${chat.status}`;
                if (chat.status !== 200) break; // quota/500 won't heal in seconds
            }
            if (chat?.status === 200 && chat.body?.sources?.length) {
                const s = chat.body.sources.find(x => x.page) || chat.body.sources[0];
                step("p.N citation present", !!s.page, `page=${s.page}`);
                step("cited page correct (3)", s.page === 3, `cited p.${s.page}`);
            } else if (!quotaSkip("chat citation", lastErr)) {
                step("chat citation", false, `${lastErr}`);
            }
        }

        // 2. Deep analysis → figure chunks
        const da = await request(app).post(`/api/v1/files/${pdfFile._id}/deep-analysis`)
            .set(auth).send({ pageStart: 1, pageEnd: 2 });
        if (da.status === 201 || da.status === 202) {
            // wait for job
            const IngestionJob = require("../models/IngestionJob");
            const job = await IngestionJob.findById(da.body.jobId);
            if (job.status === "failed" && /429|503|quota/i.test(job.error || "")) {
                quotaSkip("deep analysis", job.error);
            } else {
                const figs = await Chunk.countDocuments({ file: pdfFile._id, type: "figure" });
                step("figure chunks stored", figs > 0, `${figs} chunks, job ${job.status}`);
                step("deepAnalyzedPages tracked", (await File.findById(pdfFile._id))?.deepAnalyzedPages?.length === 2);
            }
        } else if (!quotaSkip("deep analysis", da.body?.message || `status ${da.status}`)) {
            step("deep analysis", false, `status ${da.status} ${JSON.stringify(da.body)}`);
        }

        // 3. PNG with text → description/OCR retrievable
        if (quotaExhausted) {
            quotaSkip("image describe", "preflight — upload skipped, re-run whole checklist after reset");
        } else {
        const png = Buffer.from(require("fs").readFileSync(__dirname + "/../evals/fixtures/chart.png"));
        const iup = await request(app).post("/api/v1/files/upload")
            .set(auth).attach("file", png, { filename: "chart.png", contentType: "image/png" });
        if (iup.status === 201 || iup.status === 202) {
            const img = await File.findById(iup.body.fileId || iup.body?.file?._id);
            if (img.status === "failed" && /429|503|quota/i.test(img.error || "")) {
                quotaSkip("image describe", img.error);
            } else {
                step("image described", !!img.description?.caption, img.description?.caption?.slice(0, 60));
                step("image chunks retrievable", (await Chunk.countDocuments({ file: img._id, type: "image" })) > 0);
            }
        } else if (!quotaSkip("image upload (describe)", iup.body?.message || `status ${iup.status}`)) {
            step("image upload", false, `status ${iup.status}`);
        }
        }

        // 4. CSV → tableMeta + ask-data numbers
        const csv = require("fs").readFileSync(__dirname + "/../evals/fixtures/sales.csv");
        const cup = await request(app).post("/api/v1/files/upload")
            .set(auth).attach("file", csv, { filename: "sales.csv", contentType: "text/csv" });
        const csvFile = await File.findById(cup.body?.fileId || cup.body?.file?._id);
        step("CSV tableMeta", csvFile?.tableMeta?.rowCount > 0, `${csvFile?.tableMeta?.rowCount} rows, ${csvFile?.tableMeta?.columns?.length} cols`);
        if (quotaExhausted) {
            quotaSkip("ask-data (needs NL->spec generate)", "preflight");
        } else {
        const ask = await request(app).post(`/api/v1/files/${csvFile._id}/ask-data`)
            .set(auth).send({ question: "average revenue by region as a bar chart" });
        if (ask.status === 200) {
            const rows = ask.body.rows || [];
            // independent check: avg revenue for West in fixture
            const { parse } = require("csv-parse/sync");
            const recs = parse(csv, { columns: true, skip_empty_lines: true });
            const w = recs.filter(r => r.region === "West");
            const expected = w.reduce((s, r) => s + +r.revenue, 0) / w.length;
            const got = rows.find(r => r.region === "West")?.avg_revenue ?? rows.find(r => r.region === "West")?.revenue_avg;
            step("ask-data numbers verified", got != null && Math.abs(got - expected) < 0.01,
                `avg West revenue ${got} vs expected ${expected.toFixed(2)} (rows: ${JSON.stringify(rows).slice(0, 200)})`);
        } else if (!quotaSkip("ask-data", ask.body?.message || `status ${ask.status}`)) {
            step("ask-data", false, `status ${ask.status} ${JSON.stringify(ask.body).slice(0, 200)}`);
        }
        }

        // 5. Deep-analysis resume: window 0 already done -> only window 1 runs
        if (quotaExhausted) {
            quotaSkip("deep-analysis resume", "preflight — resume verified by unit test, re-run here after reset");
        } else {
        process.env.DEEP_ANALYSIS_WINDOW_PAGES = "1"; // pages 3-4 -> 2 windows
        const { runDeepAnalysis } = require("../utils/deepAnalysis");
        const IngestionJob2 = require("../models/IngestionJob");
        const job2 = await IngestionJob2.create({
            user: userId, file: pdfFile._id, kind: "deep-analysis", status: "processing",
            stage: "describe", attempts: 1,
            state: { deepAnalysis: { pageStart: 3, pageEnd: 4, doneWindows: [0], items: [{ page: 3, type: "figure", description: "prior" }] } },
        });
        try {
            await runDeepAnalysis(job2, await File.findById(pdfFile._id));
            const j2 = await IngestionJob2.findById(job2._id);
            const figChunks = await Chunk.find({ file: pdfFile._id, type: "figure", "metadata.page": 4 });
            step("resumed job completes unfinished windows", j2.status === "done" && figChunks.length > 0, `status ${j2.status}, p4 figs ${figChunks.length}`);
        } catch (e) {
            if (!quotaSkip("deep-analysis resume", e)) step("resume", false, e.message);
        }
        }

        // 6. Cluster state: storage + prod index count (must still be 1 of 3)
        const stats = await db.stats();
        const mb = (stats.storageSize / 1e6).toFixed(1);
        let prodIdx = "n/a", prodDbName = "default";
        try {
            const prodConn = await mongoose.createConnection(uri).asPromise();
            prodDbName = prodConn.db.databaseName;
            const prodChunks = await prodConn.db.listCollections({ name: "chunks" }).toArray();
            if (prodChunks.length) {
                prodIdx = (await prodConn.db.collection("chunks").listSearchIndexes().toArray()).length;
            }
            await prodConn.close();
        } catch (e) { prodIdx = "n/a (" + e.message.slice(0, 60) + ")"; }
        results.push(`INFO eval-db storage ${mb} MB; prod db "${prodDbName}" search indexes on chunks: ${prodIdx} (must still be 1 of 3)`);
    } finally {
        if (token) {
            const del = await request(app).delete("/api/v1/auth/account").set(auth);
            step("throwaway user + data deleted", del.status === 200);
            // verify chunks/files gone
            const left = await File.countDocuments({ originalName: /pages\.pdf|chart\.png|sales\.csv/ });
            step("no leftover test files", left === 0, `${left} left`);
        }
    }
    console.log(results.join("\n"));
    const fails = results.filter(r => r.startsWith("FAIL")).length;
    console.log(`\n${results.filter(r => r.startsWith("PASS")).length} pass, ${results.filter(r => r.startsWith("SKIP")).length} skip, ${fails} fail`);
    await mongoose.disconnect();
    process.exit(fails ? 1 : 0);
}

main().catch(e => { console.error("checklist crashed:", e); process.exit(1); });
