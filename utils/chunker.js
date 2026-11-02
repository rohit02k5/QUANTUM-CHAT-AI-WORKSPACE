/**
 * Recursive Character Text Splitter — mirrors LangChain's RecursiveCharacterTextSplitter.
 *
 * Returns chunks with:
 *   text     - the chunk string (pageContent)
 *   metadata - carried from the source document + chunkIndex
 *
 * @param {Array<{pageContent, metadata}>} documents
 * @param {object} options
 *   chunkSize   - max chars per chunk (default 1000)
 *   chunkOverlap - chars to repeat between adjacent chunks (default 200)
 *   separators  - preferred split points, ordered strongest to weakest
 * @returns {Array<{pageContent: string, metadata: object}>}
 */
function recursiveSplitChunks(documents, { chunkSize = 1000, chunkOverlap = 200, separators = ["\n\n", "\n", " ", ""] } = {}) {
    const out = [];
    for (const doc of documents) {
        const { pageContent: text, metadata } = doc;
        const chunks = splitRecursive(text, chunkSize, chunkOverlap, separators);
        chunks.forEach((chunkText, i) => {
            out.push({
                pageContent: chunkText,
                metadata: {
                    ...metadata,
                    chunkIndex: i,
                    chunkTotal: chunks.length,
                },
            });
        });
    }
    return out;
}

function splitRecursive(text, remainingSize, chunkOverlap, separators) {
    if (text.length <= remainingSize) return [text];

    // Try strongest separator first
    for (const sep of separators) {
        if (!text.includes(sep)) continue;
        const pieces = text.split(sep);
        let current = "";
        const partials = [];

        for (const piece of pieces) {
            const candidate = current ? current + sep + piece : piece;
            if (candidate.length <= remainingSize) {
                current = candidate;
            } else {
                if (current) partials.push(current);
                current = piece;
            }
        }
        if (current) partials.push(current);

        // Recurse on pieces that are still too big
        const finalChunks = [];
        for (const piece of partials) {
            if (piece.length <= remainingSize) finalChunks.push(piece);
            else finalChunks.push(...splitRecursive(piece, remainingSize, chunkOverlap, separators.slice(1)));
        }

        // Apply overlap: prepend last `overlap` chars of previous chunk
        if (chunkOverlap > 0 && finalChunks.length > 1) {
            const withOverlap = [finalChunks[0]];
            for (let i = 1; i < finalChunks.length; i++) {
                const prev = finalChunks[i - 1];
                const overlap = prev.length > chunkOverlap ? prev.slice(-chunkOverlap) : prev;
                withOverlap.push(overlap + finalChunks[i]);
            }
            return withOverlap;
        }
        return finalChunks;
    }

    // Nothing matched — hard slice
    const pieces = [];
    for (let i = 0; i < text.length; i += remainingSize - chunkOverlap) {
        pieces.push(text.slice(i, i + remainingSize));
    }
    return pieces;
}

module.exports = { recursiveSplitChunks, splitRecursive };