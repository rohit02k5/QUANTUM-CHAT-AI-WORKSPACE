// ============================================
// STEP-BY-STEP VERIFICATION OF THE RAG INGESTION PIPELINE
// Run with: node verify_ingestion.js
// ============================================
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const File = require("./models/File");
const Chunk = require("./models/Chunk");
const DataLoader = require("./utils/dataLoader");
const Chunker = require("./utils/chunker");
const geminiHelper = require("./utils/geminiHelper");

dotenv.config();

const SAMPLE_FILE = "./sample_document.txt";

// A long-enough sample document so chunking produces MULTIPLE chunks
const SAMPLE_TEXT = `
QUANTUM COMPUTING OVERVIEW

Quantum computing is a rapidly-emerging technology that harnesses the laws of quantum mechanics to solve problems too complex for classical computers. Today's computers use bits - a stream of electrical or optical pulses representing 1s or 0s. Everything from your smartphone to the laptop you're reading this on can be reduced to the binary digits, or bits.

QUANTUM BITS AND SUPERPOSITION

Quantum computers, on the other hand, use quantum bits, or qubits. Unlike a classical bit, a qubit can exist in a superposition of states - meaning it can be 0 and 1 at the same time. This is what gives quantum computers their incredible power. When you measure a qubit, it collapses into a definite state, either 0 or 1.

ENTANGLEMENT

Entanglement is a purely quantum mechanical phenomenon. When two qubits are entangled, they are linked in such a way that the state of one instantly affects the state of the other, regardless of the distance between them. Albert Einstein famously called this "spooky action at a distance."

THE MERN STACK

The MERN stack is a popular JavaScript stack for building modern web applications. It consists of MongoDB for the database, Express.js for the backend framework, React for the frontend library, and Node.js for the runtime environment. Developers choose it for full-stack JavaScript development.

APPLICATIONS OF QUANTUM COMPUTING

Quantum computers have the potential to revolutionize fields like cryptography, drug discovery, optimization, and artificial intelligence. Quantum machine learning is an emerging field that could provide new ways to process and understand complex datasets.

CONCLUSION

While quantum computers are still in their early stages, they represent one of the most exciting frontiers in modern technology. Researchers continue to push the boundaries of what is possible, moving from theoretical physics to practical machines.
`;

async function verify() {
    console.log("=============================================");
    console.log("STEP-BY-STEP VERIFICATION OF INGESTION PIPELINE");
    console.log("=============================================\n");

    // ---- STEP 0: Connect ----
    console.log("[STEP 0] Connecting to MongoDB Atlas...");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("         Connected to DB:", mongoose.connection.name, "\n");

    // ---- STEP 1: Source document ----
    console.log("[STEP 1] Creating a source document file...");
    fs.writeFileSync(SAMPLE_FILE, SAMPLE_TEXT, "utf8");
    console.log("         File created:", SAMPLE_FILE);
    console.log("         File size:", fs.statSync(SAMPLE_FILE).size, "bytes\n");

    // ---- STEP 2: Load / Extract ----
    console.log("[STEP 2] Loading the document (extracting raw text)...");
    const { documents } = await DataLoader.load(SAMPLE_FILE, "text/plain");
    const content = documents.map(d => d.pageContent).join("\n\n");
    console.log("         Extract method:", documents[0] && documents[0].metadata.mimetype);
    console.log("         Extracted text length:", content.length, "characters");
    console.log("         Preview of raw text:");
    console.log("         ---------------------------------");
    console.log("         " + content.split("\n").filter(l => l.trim()).slice(0, 6).join("\n         "));
    console.log("         ---------------------------------\n");

    // ---- STEP 3: Chunking ----
    console.log("[STEP 3] Chunking the text (recursive splitter)...");
    console.log("         chunk_size=1000, overlap added between adjacent chunks");
    const chunkDocs = Chunker.recursiveSplitChunks(documents);
    const chunks = chunkDocs.map(c => c.pageContent);
    console.log("         Total chunks produced:", chunks.length);
    chunks.forEach((chunk, i) => {
        console.log(`         --- Chunk ${i + 1} (${chunk.length} chars) ---`);
        console.log(`         ${chunk.replace(/\s+/g, " ").trim().substring(0, 120)}...`);
    });
    console.log();

    // ---- STEP 4: Embedding ----
    console.log("[STEP 4] Embedding each chunk with Gemini...");
    const embeddings = [];
    for (let i = 0; i < chunks.length; i++) {
        const emb = await geminiHelper.getEmbedding(chunks[i]);
        embeddings.push(emb);
        console.log(`         Chunk ${i + 1} -> embedding vector of ${emb.length} values`);
        console.log(`                first 5 values: [${emb.slice(0, 5).map(v => v.toFixed(4)).join(", ")}...]`);
    }
    console.log();

    // ---- STEP 5: Storage ----
    console.log("[STEP 5] Saving the File record + Chunks to MongoDB Atlas...");

    // 5a. Save the File record
    const fileDoc = new File({
        user: new mongoose.Types.ObjectId(), // NOTE: dummy user id for this standalone test
        filename: path.basename(SAMPLE_FILE),
        originalName: "sample_document.txt",
        path: SAMPLE_FILE,
        mimetype: "text/plain",
        size: content.length,
        content,
    });
    await fileDoc.save();
    console.log(`         File saved in collection 'files' with _id: ${fileDoc._id}`);
    console.log(`           _id       : ${fileDoc._id}`);
    console.log(`           original  : ${fileDoc.originalName}`);
    console.log(`           mimetype  : ${fileDoc.mimetype}`);
    console.log(`           size      : ${fileDoc.size} bytes`);
    console.log(`           content   : stored as string in the 'content' field\n`);

    // 5b. Save the Chunks
    const savedChunks = [];
    for (let i = 0; i < chunks.length; i++) {
        const chunkDoc = await Chunk.create({
            user: fileDoc.user,
            file: fileDoc._id,
            text: chunks[i],
            pageContent: chunks[i],
            metadata: chunkDocs[i].metadata,
            embedding: embeddings[i],
        });
        savedChunks.push(chunkDoc);
        console.log(`         Chunk ${i + 1} saved in collection 'chunks' with _id: ${chunkDoc._id}`);
    }
    console.log();

    // ---- STEP 6: Read back from DB to prove persistence ----
    console.log("[STEP 6] Reading the data BACK from MongoDB to prove it persisted...");
    const readBackFile = await File.findById(fileDoc._id);
    console.log(`         File record found: ${readBackFile ? "YES" : "NO"}`);
    console.log(`           originalName : ${readBackFile ? readBackFile.originalName : "-"}`);
    console.log(`           content len  : ${readBackFile ? readBackFile.content.length : "-"} chars`);

    const countChunks = await Chunk.countDocuments({ file: fileDoc._id });
    console.log(`         Chunks stored for this file: ${countChunks}`);

    const readBackChunks = await Chunk.find({ file: fileDoc._id }).sort({ _id: 1 });
    readBackChunks.forEach((c, i) => {
        console.log(`           Chunk ${i + 1}: text="${c.text.replace(/\s+/g, " ").trim().substring(0, 60)}..." embedding=[${c.embedding.length} values]`);
    });
    console.log();

    // ---- STEP 7: Cleanup ----
    console.log("[STEP 7] Cleaning up test records (so re-runs stay idempotent)...");
    await File.deleteMany({ _id: fileDoc._id });
    await Chunk.deleteMany({ file: fileDoc._id });
    fs.unlinkSync(SAMPLE_FILE);
    console.log("         Test File, Chunks, and sample file removed.\n");

    console.log("=============================================");
    console.log("VERIFICATION COMPLETE - FULL PIPELINE WORKS");
    console.log(" Load     -> chunk     -> embed     -> save");
    console.log("=============================================");
    mongoose.connection.close();
    process.exit(0);
}

verify().catch((err) => {
    console.error("VERIFICATION FAILED:", err);
    process.exit(1);
});