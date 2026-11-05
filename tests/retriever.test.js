const mongoose = require("mongoose");
const Chunk = require("../models/Chunk");
const File = require("../models/File");
const { retrieveChunks, buildContext } = require("../utils/retriever");
const mock = require("../utils/geminiMock");

describe("retriever (cosine fallback on non-Atlas Mongo)", () => {
    let userId, fileId;

    beforeAll(async () => {
        userId = new mongoose.Types.ObjectId();
        const file = await File.create({
            user: userId, filename: "d.txt", originalName: "d.txt",
            path: "x", mimetype: "text/plain",
        });
        fileId = file._id;

        // Seed chunks with controlled similarity via SIM: tokens.
        // query "SIM:alpha ..." embeds near chunks sharing SIM:alpha.
        for (const [i, text] of [
            "SIM:alpha cats are fluffy",
            "SIM:alpha cats nap a lot",
            "SIM:beta quantum computing uses qubits",
        ].entries()) {
            await Chunk.create({
                user: userId, file: fileId,
                text, pageContent: text,
                metadata: { chunkIndex: i },
                embedding: await mock.embed(text),
                embeddingDims: 768, embeddingModel: "mock",
            });
        }
    });

    it("falls back to cosine ranking and returns most similar chunks first", async () => {
        const res = await retrieveChunks(userId, "SIM:alpha tell me about cats", 3);
        expect(res.length).toBeGreaterThan(0);
        // alpha chunks should outrank the beta chunk
        const names = res.map((r) => r.text);
        expect(names[0]).toMatch(/cats/);
        // scores sorted desc
        const scores = res.map((r) => r.score);
        expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    });

    it("scopes retrieval to the requesting user only", async () => {
        const other = new mongoose.Types.ObjectId();
        const res = await retrieveChunks(other, "SIM:alpha cats", 3);
        expect(res).toHaveLength(0);
    });

    it("scopes to requested fileIds", async () => {
        const otherFile = await File.create({
            user: userId, filename: "e.txt", originalName: "e.txt", path: "y", mimetype: "text/plain",
        });
        const res = await retrieveChunks(userId, "SIM:alpha cats", 3, [otherFile._id]);
        expect(res).toHaveLength(0);
    });

    it("ignores chunks whose embedding dims don't match config", async () => {
        const odd = await Chunk.create({
            user: userId, file: fileId,
            text: "SIM:alpha legacy 3072 chunk",
            embedding: new Array(3072).fill(0.01),
            embeddingDims: 3072,
        });
        const res = await retrieveChunks(userId, "SIM:alpha cats", 10);
        expect(res.every((r) => r.text !== "SIM:alpha legacy 3072 chunk")).toBe(true);
        await odd.deleteOne();
    });

    // Regression: on Atlas, $vectorSearch against a collection without the
    // index returns [] instead of throwing — the fallback never engaged and
    // retrieval silently returned nothing. The retriever must check
    // listSearchIndexes first and use cosine when the index is absent.
    it("falls back to cosine when the search index is absent (empty listSearchIndexes)", async () => {
        const coll = mongoose.connection.collection("chunks");
        const origList = coll.listSearchIndexes;
        const origAgg = coll.aggregate;
        let vectorSearchAttempted = false;
        coll.listSearchIndexes = () => ({ toArray: async () => [] }); // index missing
        coll.aggregate = (pipeline) => {
            if (pipeline?.[0]?.$vectorSearch) vectorSearchAttempted = true;
            return origAgg.call(coll, pipeline);
        };
        try {
            const res = await retrieveChunks(userId, "SIM:alpha cats", 3);
            expect(vectorSearchAttempted).toBe(false);
            expect(res.length).toBeGreaterThan(0);
            expect(res[0].text).toMatch(/cats/);
        } finally {
            coll.listSearchIndexes = origList;
            coll.aggregate = origAgg;
        }
    });

    it("buildContext formats citations", () => {
        const ctx = buildContext([
            { text: "hello", originalName: "doc.pdf", metadata: { page: 3 } },
        ]);
        expect(ctx).toContain("[Source 1: doc.pdf (page 3)]");
        expect(ctx).toContain("hello");
    });
});
