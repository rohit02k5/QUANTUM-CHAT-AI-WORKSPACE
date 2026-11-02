const fs = require("fs");
const { PDFParse } = require("pdf-parse");
const mammoth = require("mammoth");

/**
 * Document-oriented loader: returns LangChain-style Document objects with
 * page_content + metadata (like the reference repo).
 *
 * Each Document is the *unit of chunking* - the splitter receives
 * [{ pageContent, metadata }, ...] and yields chunks that keep metadata.
 *
 * For PDFs: each page becomes a Document with metadata.page.
 * For TXT/CSV/MD/JSON: one Document with metadata summarizing the file.
 */
class DataLoader {
    /**
     * @param {string} filePath  path to the uploaded file
     * @param {string} mimetype  express/multer mimeType
     * @returns {Promise<{ documents: Array<{pageContent: string, metadata: object}> }>}
     */
    static async load(filePath, mimetype) {
        const metadata = {
            source: filePath,
            mimetype,
            loadedAt: new Date().toISOString(),
        };

        if (mimetype === "application/pdf") {
            return DataLoader._loadPdf(filePath, metadata);
        }
        if (mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
            return DataLoader._loadDocx(filePath, metadata);
        }
        if (mimetype === "text/plain" || mimetype === "text/markdown" || mimetype === "text/x-markdown") {
            return DataLoader._loadText(filePath, metadata);
        }
        if (mimetype === "text/csv" || mimetype === "application/csv" || mimetype === "application/vnd.ms-excel") {
            return DataLoader._loadCsv(filePath, metadata);
        }
        if (mimetype === "application/json") {
            return DataLoader._loadJson(filePath, metadata);
        }
        throw new Error(`Unsupported file type: ${mimetype}`);
    }

    static async _loadPdf(filePath, metadata) {
        const buf = fs.readFileSync(filePath);
        const parser = new PDFParse(new Uint8Array(buf));
        const info = await parser.load();

        const documents = [];
        const totalPages = info.numPages;

        for (let i = 0; i < totalPages; i++) {
            try {
                const page = await parser.getText({ pageIndex: i });
                const text = (page && page.text ? page.text : "").trim();
                if (text) {
                    documents.push({
                        pageContent: text,
                        metadata: {
                            ...metadata,
                            page: i + 1, // 1-based, matches PDF footprint
                            totalPages,
                        },
                    });
                }
            } catch (err) {
                // Skip unreadable pages rather than failing the whole file
                console.warn(`[DataLoader] Skipping PDF page ${i + 1}: ${err.message}`);
            }
        }

        return { documents };
    }

    static async _loadDocx(filePath, metadata) {
        const result = await mammoth.extractRawText({ path: filePath });
        const text = result.value.trim();
        return {
            documents: text ? [{ pageContent: text, metadata }] : [],
        };
    }

    static async _loadText(filePath, metadata) {
        const text = fs.readFileSync(filePath, "utf8").trim();
        return {
            documents: text ? [{ pageContent: text, metadata }] : [],
        };
    }

    static async _loadCsv(filePath, metadata) {
        const raw = fs.readFileSync(filePath, "utf8");
        const rows = raw.split(/\r?\n/).filter((l) => l.trim());
        metadata.rows = rows.length;
        // Convert rows into readable sentences (keeps row context in chunks)
        const analytics = rows.length > 1 ? DataLoader._csvToDocuments(raw) : [];
        const pageText = analytics.map((d) => d.pageContent).join("\n\n");
        return {
            documents: pageText
                ? analytics.map((d) => ({
                      pageContent: d.pageContent,
                      metadata: { ...metadata, row: d.metadata.row },
                  }))
                : [],
        };
    }

    static async _loadJson(filePath, metadata) {
        let parsed;
        try {
            parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        } catch (e) {
            throw new Error("Invalid JSON file: " + e.message);
        }
        // Keep structure as readable sentences so embeddings keep column meaning
        const pageText = JSON.stringify(parsed, null, 2);
        return {
            documents: [{ pageContent: pageText, metadata }],
        };
    }

    /**
     * Convert CSV into per-row Documents so chunking keeps row boundaries.
     */
    static _csvToDocuments(raw) {
        const lines = raw.split(/\r?\n/).filter((l) => l.trim());
        if (lines.length === 0) return [];
        const headers = parseCsvLine(lines[0]);
        const docs = [];
        for (let i = 1; i < lines.length; i++) {
            const cells = parseCsvLine(lines[i]);
            const pairs = cells.map((cell, idx) => {
                const key = headers[idx] !== undefined ? headers[idx].trim() : `col${idx + 1}`;
                return `${key}: ${cell.trim()}`;
            });
            docs.push({
                pageContent: `Row ${i}: ${pairs.join(", ")}`,
                metadata: { row: i },
            });
        }
        return docs;
    }
}

/** Minimal CSV line parser respecting double-quoted fields ("" = escaped quote). */
function parseCsvLine(line) {
    const cells = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                if (line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                current += ch;
            }
        } else {
            if (ch === '"') inQuotes = true;
            else if (ch === ",") {
                cells.push(current);
                current = "";
            } else current += ch;
        }
    }
    cells.push(current);
    return cells;
}

module.exports = DataLoader;