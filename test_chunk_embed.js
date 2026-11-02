const dotenv = require("dotenv");
dotenv.config();
const Chunker = require("./utils/chunker");
const geminiHelper = require("./utils/geminiHelper");

async function testChunkAndEmbed() {
    try {
        console.log("=== 1. Testing Chunker ==;");
        const sampleText = "Quantum computing is a rapidly-emerging technology that harnesses the laws of quantum mechanics to solve problems too complex for classical computers. MERN stack is a popular JavaScript stack.";
        const chunks = Chunker.splitText(sampleText, 50, 10);
        console.log(`Generated ${chunks.length} chunks:`);
        chunks.forEach((c, i) => console.log(`[Chunk ${i+1}]: ${c}`));

        console.log("\n=== 2. Testing Gemini Embedding (text-embedding-004) ==;");
        if (!process.env.GEMINI_API_KEY) {
            console.error("Missing GEMINI_API_KEY in .env");
            return;
        }
        const embedding = await geminiHelper.getEmbedding(chunks[0]);
        console.log(`Successfully generated embedding! Dimension: ${embedding.length}`);
        console.log(`First 5 values:`, embedding.slice(0, 5));

        console.log("\nSuccess! Chunker and Gemini Embeddings are fully working.");
    } catch (err) {
        console.error("Test failed:", err);
    }
}

testChunkAndEmbed();
