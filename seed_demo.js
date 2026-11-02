// ============================================
// SEED A SAMPLE DOCUMENT INTO YOUR ATLAS DB
// This does NOT delete anything - run it, then browse Atlas.
// Run with: node seed_demo.js
// ============================================
const mongoose = require("mongoose");
const fs = require("fs");
const dotenv = require("dotenv");
const File = require("./models/File");
const Chunk = require("./models/Chunk");
const DataLoader = require("./utils/dataLoader");
const Chunker = require("./utils/chunker");
const geminiHelper = require("./utils/geminiHelper");

dotenv.config();

const SAMPLE_FILE = "./sample_document.txt";

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

async function seed() {
    console.log("=== SEEDING SAMPLE DOCUMENT INTO ATLAS ===\n");

    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to database:", mongoose.connection.name, "\n");

    fs.writeFileSync(SAMPLE_FILE, SAMPLE_TEXT, "utf8");

    // 1. Load
    console.log("[1] Loading text from", SAMPLE_FILE);
    const { content } = await DataLoader.load(SAMPLE_FILE, "text/plain");
    console.log("    Extracted", content.length, "characters\n");

    // 2. Chunk
    console.log("[2] Chunking...");
    const chunks = Chunker.splitText(content);
    console.log("    Produced", chunks.length, "chunks\n");

    // 3. Save File record (uses a fixed dummy user id so you can identify it)
    const DUMMY_USER = new mongoose.Types.ObjectId("000000000000000000000001");
    const fileDoc = await File.create({
        user: DUMMY_USER,
        filename: "sample_document.txt",
        originalName: "sample_document.txt",
        path: SAMPLE_FILE,
        mimetype: "text/plain",
        size: content.length,
        content,
    });
    console.log("[3] Saved FILE document:");
    console.log("    _id          :", fileDoc._id);
    console.log("    originalName :", fileDoc.originalName);
    console.log("    collection   : files\n");

    // 4. Embed + save chunks (keep this data!)
    console.log("[4] Embedding each chunk and saving CHUNK documents...");
    for (let i = 0; i < chunks.length; i++) {
        console.log(`    Embedding chunk ${i + 1}/${chunks.length}...`);
        const embedding = await geminiHelper.getEmbedding(chunks[i]);
        const chunkDoc = await Chunk.create({
            user: DUMMY_USER,
            file: fileDoc._id,
            text: chunks[i],
            embedding,
        });
        console.log(`      -> saved chunk _id: ${chunkDoc._id} (embedding: ${embedding.length} values)`);
    }

    // 5. Confirm counts
    const fileCount = await File.countDocuments();
    const chunkCount = await Chunk.countDocuments();
    console.log("\n=== DONE. Data is PERSISTED in Atlas ===");
    console.log("files collection total docs :", fileCount);
    console.log("chunks collection total docs:", chunkCount);

    console.log("\nNOW GO LOOK IN ATLAS:");
    console.log("  Atlas -> Browse Collections -> database 'quantum-chat-ai'");
    console.log("  -> collections: 'files' and 'chunks'");

    mongoose.connection.close();
    process.exit(0);
}

seed().catch((err) => {
    console.error("SEED FAILED:", err);
    process.exit(1);
});