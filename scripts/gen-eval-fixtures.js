/**
 * Generates the committed eval fixtures:
 *  - evals/fixtures/pages.pdf     — 5-page PDF, distinct content per page
 *  - evals/fixtures/chart.png     — small bar-chart PNG (< 100KB), pure JS
 *  - evals/fixtures/sales.csv     — CSV with known aggregates
 *  - evals/fixtures/chart.desc.json — deterministic image description the
 *    eval harness turns into image chunks (the vision call is covered by
 *    unit tests with GEMINI_MOCK; the eval measures retrieval quality)
 *
 *   node scripts/gen-eval-fixtures.js
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUT = path.join(__dirname, "../evals/fixtures");

// ---------------------------------------------------------------------------
// pages.pdf — 5 pages, each with distinct extractable text
// ---------------------------------------------------------------------------
async function makePdf() {
    const { PDFDocument, StandardFonts } = require("pdf-lib");
    const pages = [
        "PAGE ONE — ORBITAL MECHANICS. Orbital velocity for a circular orbit is v = sqrt(GM/r). " +
            "A low Earth orbit at 300 km altitude travels at roughly 7.7 km/s and circles the planet every 90 minutes.",
        "PAGE TWO — SOURDOUGH BAKING. A 75% hydration dough uses 500g flour and 375g water. " +
            "Bulk fermentation takes 4 hours at 24C, followed by a 12 hour cold proof in the refrigerator.",
        "PAGE THREE — 1972 OLYMPIC CHESS. Bobby Fischer beat Boris Spassky in Reykjavik by 12.5 to 8.5 points. " +
            "Game 6, a Queen's Gambit Declined, is considered the finest game of the match.",
        "PAGE FOUR — KUBERNETES NETWORKING. Every Pod gets its own IP address; Services provide a stable virtual IP. " +
            "kube-proxy programs iptables rules so ClusterIP traffic reaches the right backend pods.",
        "PAGE FIVE — JAPANESE GARDEN DESIGN. The tsukubai water basin sits near the tea house so guests can purify " +
            "their hands. Stone lanterns called toro mark the path, and maple trees provide autumn color.",
    ];
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const text of pages) {
        const page = doc.addPage([500, 500]);
        // crude wrap at ~75 chars
        const lines = text.match(/.{1,75}(\s|$)/g) || [];
        lines.forEach((l, i) => page.drawText(l.trim(), { x: 30, y: 450 - i * 16, size: 11, font }));
    }
    fs.writeFileSync(path.join(OUT, "pages.pdf"), Buffer.from(await doc.save()));
}

// ---------------------------------------------------------------------------
// chart.png — pure-JS PNG encoder (no canvas): quarterly revenue bar chart
// ---------------------------------------------------------------------------

// CRC32 for PNG chunks
const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();
function crc32(buf) {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}
function encodePng(width, height, pixelAt) {
    // RGBA scanlines, filter byte 0 per row
    const raw = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (width * 4 + 1)] = 0;
        for (let x = 0; x < width; x++) {
            const [r, g, b, a] = pixelAt(x, y);
            const o = y * (width * 4 + 1) + 1 + x * 4;
            raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
        }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
        chunk("IEND", Buffer.alloc(0)),
    ]);
}

function makeChartPng() {
    const W = 320, H = 200;
    const bars = [10, 14, 19, 27]; // Q1..Q4 revenue
    const maxH = 140, floorY = 170;
    const pixelAt = (x, y) => {
        // white background
        let c = [255, 255, 255, 255];
        // axes
        if (x === 30 || y === floorY) c = [40, 40, 40, 255];
        // bars: 4 bars, 40px wide, 60px spacing, from x=50
        for (let i = 0; i < 4; i++) {
            const bx = 50 + i * 60;
            const bh = Math.round((bars[i] / 30) * maxH);
            if (x >= bx && x < bx + 40 && y >= floorY - bh && y < floorY) {
                c = [66, 133, 244, 255];
            }
        }
        return c;
    };
    const png = encodePng(W, H, pixelAt);
    fs.writeFileSync(path.join(OUT, "chart.png"), png);
    fs.writeFileSync(path.join(OUT, "chart.desc.json"), JSON.stringify({
        caption: "A bar chart titled Quarterly Revenue showing four blue bars rising left to right.",
        ocrText: "Quarterly Revenue Q1 10 Q2 14 Q3 19 Q4 27",
        dataInsights: "Revenue grows every quarter, more than doubling from 10 in Q1 to 27 in Q4.",
        tags: ["chart", "bar", "revenue", "quarterly"],
    }, null, 2));
}

// ---------------------------------------------------------------------------
// sales.csv — known aggregates (see evals/golden/questions.json table cases)
// ---------------------------------------------------------------------------
function makeCsv() {
    const rows = ["region,quarter,revenue,units"];
    const data = [
        ["East", "Q1", 10, 100], ["West", "Q1", 14, 120],
        ["East", "Q2", 19, 140], ["West", "Q2", 27, 180],
        ["East", "Q3", 30, 200], ["West", "Q3", 22, 160],
        ["East", "Q4", 41, 260], ["West", "Q4", 33, 210],
    ];
    for (const r of data) rows.push(r.join(","));
    // avg revenue by region: East (10+19+30+41)/4 = 25 ; West (14+27+22+33)/4 = 24
    // total units by region: East 700 ; West 670
    fs.writeFileSync(path.join(OUT, "sales.csv"), rows.join("\n"));
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    await makePdf();
    makeChartPng();
    makeCsv();
    for (const f of ["pages.pdf", "chart.png", "chart.desc.json", "sales.csv"]) {
        const s = fs.statSync(path.join(OUT, f));
        console.log(`${f}  ${s.size} bytes`);
    }
})();
