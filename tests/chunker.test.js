const { recursiveSplitChunks } = require("../utils/chunker");

describe("chunker", () => {
    it("returns a single chunk when text fits", () => {
        const docs = [{ pageContent: "short text", metadata: { source: "t" } }];
        const out = recursiveSplitChunks(docs, { chunkSize: 1000, chunkOverlap: 200 });
        expect(out).toHaveLength(1);
        expect(out[0].pageContent).toBe("short text");
        expect(out[0].metadata.chunkIndex).toBe(0);
    });

    it("splits long text into <= chunkSize pieces (plus overlap)", () => {
        const text = "word ".repeat(1000).trim(); // ~5000 chars
        const docs = [{ pageContent: text, metadata: {} }];
        const out = recursiveSplitChunks(docs, { chunkSize: 1000, chunkOverlap: 100 });
        expect(out.length).toBeGreaterThan(3);
        for (const c of out) {
            // chunk + overlap prefix can exceed chunkSize by at most overlap
            expect(c.pageContent.length).toBeLessThanOrEqual(1000 + 100);
        }
        // metadata preserved + indexed
        expect(out[0].metadata.chunkTotal).toBe(out.length);
        expect(out.map((c) => c.metadata.chunkIndex)).toEqual(out.map((_, i) => i));
    });

    it("handles empty documents gracefully", () => {
        const out = recursiveSplitChunks([{ pageContent: "", metadata: {} }], {});
        expect(out).toHaveLength(1); // empty string is one (empty) chunk
    });
});
