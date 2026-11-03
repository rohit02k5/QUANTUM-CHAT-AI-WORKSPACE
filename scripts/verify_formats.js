// ============================================
// MULTI-FORMAT RAG INGESTION VERIFICATION
// Tests: TXT, MD, CSV, JSON (and PDF if one is provided)
// Run with: node verify_formats.js
// ============================================
const mongoose = require("mongoose");
const fs = require("fs");
const dotenv = require("dotenv");
const File = require("../models/File");
const Chunk = require("../models/Chunk");
const DataLoader = require("../utils/dataLoader");
const Chunker = require("../utils/chunker");
const geminiHelper = require("../utils/geminiHelper");

dotenv.config();

const DUMMY_USER = new mongoose.Types.ObjectId("000000000000000000000001");

// -----------------------------------------------
// CREATE SAMPLE FILES
// -----------------------------------------------
const samples = [
    {
        name: "notes.txt",
        mimetype: "text/plain",
        content: [
            "MEETING NOTES - PROJECT QUANTUM",
            "",
            "Agenda: Review the RAG pipeline implementation.",
            "Decision: Use Gemini embeddings with 3072 dimensions.",
            "Action item: Harshita to create the Atlas Search index.",
            "Action item: Set chunk size to 1000 characters.",
            "Follow-up meeting scheduled next Monday.",
            "Budget for the quarter was revised to 20,000 units.",
        ].join("\n"),
    },
    {
        name: "readme.md",
        mimetype: "text/markdown",
        content: [
            "# Quantum AI Suite",
            "",
            "A unified workspace with AI chat, document intelligence,",
            "knowledge graphs and executive summaries.",
            "",
            "## Modules",
            "",
            "- Quantum Chat: context aware conversational AI",
            "- Insight Engine: deep content and knowledge intelligence",
            "- NeuraPix: AI image generation with Stable Diffusion",
            "- Knowledge Base: persistent AI memory",
            "",
            "Deployed on Render with MongoDB Atlas backend.",
        ].join("\n"),
    },
    {
        name: "sales_data.csv",
        mimetype: "text/csv",
        content: [
            "quarter,region,product,revenue",
            "Q1,North,Widget A,12000",
            "Q1,South,Widget B,8500",
            "Q2,North,Widget B,14500",
            "Q2,South,Widget A,9800",
            "Q3,East,Widget C,22000",
            "Q3,West,Widget A,17100",
        ].join("\n"),
    },
    {
        name: "config.json",
        mimetype: "application/json",
        content: JSON.stringify({
            app: "Quantum AI",
            version: "1.0.0",
            features: ["rag", "chat", "studio", "neurapix"],
            auth: { type: "jwt", oauth: ["google", "github"] },
            vector: { dimensions: 3072, index: "chunks_embedding_index" },
        }, null, 2),
    },
];

async function verify() {
    console.log("=== MULTI-FORMAT RAG INGESTION VERIFICATION ===\n");

    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to database:", mongoose.connection.name, "\n");

    // ---- PDF / DOCX test (only if files exist) ----
    const pdfPath = "./sample_book.pdf";
    const docxPath = "./sample_doc.docx";
    if (fs.existsSync(pdfPath)) samples.push({ name: "sample_book.pdf", mimetype: "application/pdf", path: pdfPath });
    if (fs.existsSync(docxPath)) samples.push({ name: "sample_doc.docx", mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", path: docxPath });

    for (const sample of samples) {
        console.log(`>>> TESTING: ${sample.name} (${sample.mimetype})`);
        const filePath = sample.path || `./${sample.name}`;
        if (!sample.path) fs.writeFileSync(filePath, sample.content);

        try {
            // 1. Load
            const { content, metadata } = await DataLoader.load(filePath, sample.mimetype);
            console.log(`    [LOAD]  extracted ${content.length} chars`);
            console.log(`    [LOAD]  metadata: pages=${metadata.pages ?? "-"} rows=${metadata.rows ?? "-"}`);
            console.log(`    [LOAD]  preview: ${content.split(/\s+/).slice(0, 12).join(" ")}...`);

            // 2. Chunk
            const chunks = Chunker.splitText(content);
            console.log(`    [CHUNK] produced ${chunks.length} chunk(s)`);
            chunks.slice(0, 4).forEach((c, i) => {
                console.log(`            chunk${i + 1} (${c.length} chars): ${c.replace(/\s+/g, " ").trim().substring(0, 90)}...`);
            });
            if (chunks.length > 4) console.log(`            ... and ${chunks.length - 4} more`);

            // 3. Save File record + all embedded chunks (PERSISTS in Atlas)
            const fileDoc = await File.create({
                user: DUMMY_USER,
                filename: sample.name,
                originalName: sample.name,
                path: filePath,
                mimetype: sample.mimetype,
                size: content.length,
                content,
            });
            console.log(`    [SAVE]  file saved _id=${fileDoc._id}`);

            for (let i = 0; i < chunks.length; i++) {
                const emb = await geminiHelper.getEmbedding(chunks[i]);
                const chunkDoc = await Chunk.create({
                    user: DUMMY_USER,
                    file: fileDoc._id,
                    text: chunks[i],
                    embedding: emb,
                });
                if (i === 0 || i === chunks.length - 1) {
                    console.log(`    [EMBED] chunk ${i + 1} saved _id=${chunkDoc._id} (dim ${emb.length})`);
                }
            }
            console.log(`    [SAVE]  ${chunks.length} chunk(s) stored for ${sample.name}`);
            console.log(`    [PASS]  ${sample.name}: load+chunk+embed+save OK\n`);
        } catch (err) {
            console.log(`    [FAIL]  ${sample.name}: ${err.message}\n`);
        }
    }

    const byFile = await File.aggregate([
        { $match: { user: DUMMY_USER } },
        { $lookup: { from: "chunks", localField: "_id", foreignField: "file", as: "chunks" } },
        { $project: { originalName: 1, chunkCount: { $size: "$chunks" } } },
        { $sort: { originalName: 1 } },
    ]);
    console.log("\n=== RECORDS NOW IN ATLAS (database: quantum-chat-ai) ===");
    byFile.forEach((f) => console.log(`  file: ${f.originalName} -> ${f.chunkCount} chunk(s)`));
    console.log("=== VERIFICATION COMPLETE ===");
    mongoose.connection.close();
    process.exit(0);
}

verify().catch((err) => {
    console.error("VERIFICATION FAILED:", err);
    process.exit(1);
});