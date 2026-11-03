const mongoose = require("mongoose");
const fs = require("fs");
const dotenv = require("dotenv");
const Chunk = require("../models/Chunk");
const File = require("../models/File");
const DataLoader = require("../utils/dataLoader");
const Chunker = require("../utils/chunker");
const geminiHelper = require("../utils/geminiHelper");

dotenv.config();

async function testIngestion() {
    try {
        // Connect to DB
        await mongoose.connect(process.env.MONGO_URI);
        console.log("Connected to MongoDB.");

        // Paths - Create a dummy file if you don't have one
        const testFilePath = "./test_doc.txt";
        fs.writeFileSync(testFilePath, "This is a test document for RAG ingestion. It contains information about quantum mechanics and AI. This should be chunked properly.");

        const mimetype = "text/plain";
        const userId = new mongoose.Types.ObjectId(); // Dummy User

        console.log("1. Loading Data...");
        const { documents } = await DataLoader.load(testFilePath, mimetype);
        const content = documents.map(d => d.pageContent).join("\n\n");

        console.log("2. Chunking Data...");
        const chunkDocs = Chunker.recursiveSplitChunks(documents);
        console.log(`Extracted ${chunkDocs.length} chunks.`);

        console.log("3. Embedding and Saving Chunks...");
        const newFile = new File({
            user: userId,
            filename: "test_doc.txt",
            originalName: "test_doc.txt",
            path: testFilePath,
            mimetype,
            size: content.length,
            content
        });
        await newFile.save();

        for (const cd of chunkDocs) {
            console.log(`Embedding chunk: ${cd.pageContent.substring(0, 50)}...`);
            const embedding = await geminiHelper.getEmbedding(cd.pageContent);
            await Chunk.create({
                user: userId,
                file: newFile._id,
                text: cd.pageContent,
                pageContent: cd.pageContent,
                metadata: cd.metadata,
                embedding: embedding,
            });
        }

        console.log("Ingestion test complete! Check your 'chunks' collection in MongoDB.");
        process.exit(0);
    } catch (err) {
        console.error("Test failed:", err);
        process.exit(1);
    }
}

testIngestion();
