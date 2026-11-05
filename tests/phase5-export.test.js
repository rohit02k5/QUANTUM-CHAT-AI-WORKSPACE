// Phase 5.3: exports — Markdown snapshot, CSV escaping/formula-injection,
// cross-user isolation, memory JSON portability.
const mongoose = require("mongoose");
const { request, app, createUser, auth } = require("./helpers");
const Chat = require("../models/Chat");
const Deck = require("../models/Deck");
const Card = require("../models/Card");
const Memory = require("../models/Memory");
const { csvCell, cardsToCsv, chatToMarkdown } = require("../utils/exporters");

describe("5.3 export formatters (unit)", () => {
    it("csvCell quotes RFC-4180 and guards formula injection", () => {
        expect(csvCell("plain")).toBe("plain");
        expect(csvCell('has "quotes"')).toBe('"has ""quotes"""');
        expect(csvCell("comma, here")).toBe('"comma, here"');
        expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
        // Formula-injection: = + - @ all get the leading apostrophe
        expect(csvCell("=1+1")).toBe("'=1+1");
        expect(csvCell("+SUM(A1:A2)")).toBe("'+SUM(A1:A2)");
        expect(csvCell("-10")).toBe("'-10");
        expect(csvCell("@cmd")).toBe("'@cmd");
        // Formula cell containing quotes gets the apostrophe AND RFC quoting
        expect(csvCell("=WEBSERVICE(\"http://evil\")")).toBe("\"'=WEBSERVICE(\"\"http://evil\"\")\"");
        // Toggle off → raw (documented for Anki)
        expect(csvCell("=1+1", { escapeFormula: false })).toBe("=1+1");
        // Edge: apostrophe-prefixed cell containing a comma still gets quoted
        expect(csvCell("=x,y")).toBe("\"'=x,y\"");
        expect(csvCell("")).toBe("");
        expect(csvCell(null)).toBe("");
    });

    it("cardsToCsv emits Front,Back,Deck header + CRLF rows", () => {
        const csv = cardsToCsv([{ front: "Q?", back: "A.", deckName: "Bio" }]);
        expect(csv).toBe("Front,Back,Deck\r\nQ?,A.,Bio");
    });

    it("chatToMarkdown produces the documented shape (snapshot-ish)", () => {
        const md = chatToMarkdown({
            title: "RAG chat",
            createdAt: new Date("2025-01-01T00:00:00Z"),
            messages: [
                { role: "user", content: "what is RAG?", timestamp: new Date("2025-01-01T00:01:00Z") },
                {
                    role: "model", content: "RAG combines retrieval with generation.",
                    timestamp: new Date("2025-01-01T00:01:05Z"),
                    sources: [{ originalName: "rag.pdf", page: 3, snippet: "..." }],
                    trace: [{ tool: "search_knowledge_base", ok: true, ms: 120 }],
                },
            ],
        });
        expect(md).toContain("# RAG chat");
        expect(md).toContain("**You** _(2025-01-01 00:01Z)_:");
        expect(md).toContain("what is RAG?");
        expect(md).toContain("**Quantum**");
        expect(md).toContain("RAG combines retrieval with generation.");
        expect(md).toContain("[^1] rag.pdf p.3");
        expect(md).toContain("`search_knowledge_base`(ok, 120ms)");
        // Flagged source marker
        const flagged = chatToMarkdown({
            title: "t", messages: [
                { role: "model", content: "x", sources: [{ originalName: "evil.txt", flagged: true }] },
            ],
        });
        expect(flagged).toContain("⚠️");
        // Partial marker
        const partial = chatToMarkdown({ title: "t", messages: [{ role: "model", content: "cut", truncated: true }] });
        expect(partial).toContain("partial answer");
    });
});

describe("5.3 export endpoints", () => {
    it("chat Markdown downloads with attachment headers", async () => {
        const u = await createUser();
        const uid = (await mongoose.model("User").findOne({ email: u.email }))._id;
        const chat = await Chat.create({
            user: uid, title: "Export me",
            messages: [
                { role: "user", content: "hello there" },
                { role: "model", content: "hi — answer", sources: [{ originalName: "doc.pdf", page: 2 }] },
            ],
        });
        const r = await request(app).get(`/api/v1/export/chat/${chat._id}`).set(auth(u.token));
        expect(r.status).toBe(200);
        expect(r.headers["content-type"]).toContain("text/markdown");
        expect(r.headers["content-disposition"]).toContain("attachment");
        expect(r.headers["content-disposition"]).toContain(".md");
        expect(r.text).toContain("# Export me");
        expect(r.text).toContain("hello there");
        expect(r.text).toContain("[^1] doc.pdf p.2");
    });

    it("cards CSV has BOM, attachment headers, and escaped cells", async () => {
        const u = await createUser();
        const uid = (await mongoose.model("User").findOne({ email: u.email }))._id;
        const deck = await Deck.create({ user: uid, name: "Chem" });
        await Card.create([
            { user: uid, deck: deck._id, front: "what is H2O?", back: "water" },
            { user: uid, deck: deck._id, front: "=hostile()", back: "safe" },
        ]);
        const r = await request(app).get("/api/v1/export/cards.csv").set(auth(u.token));
        expect(r.status).toBe(200);
        expect(r.headers["content-type"]).toContain("text/csv");
        expect(r.headers["content-disposition"]).toContain("attachment");
        expect(r.text.charCodeAt(0)).toBe(0xFEFF); // BOM
        expect(r.text).toContain("Front,Back,Deck");
        expect(r.text).toContain("what is H2O?,water,Chem");
        expect(r.text).toContain("'=hostile(),safe,Chem"); // apostrophe-guarded
        // Deck-scoped export + escape toggle
        const deckOnly = await request(app).get(`/api/v1/export/cards.csv?deck=${deck._id}&escape=0`).set(auth(u.token));
        expect(deckOnly.text).toContain("=hostile(),safe,Chem"); // unescaped for Anki
    });

    it("cross-user isolation — exports never leak another user's data", async () => {
        const ua = await createUser();
        const ub = await createUser();
        const uidA = (await mongoose.model("User").findOne({ email: ua.email }))._id;
        const chatA = await Chat.create({ user: uidA, title: "A private", messages: [{ role: "user", content: "secret stuff" }] });
        const deckA = await Deck.create({ user: uidA, name: "A deck" });
        await Card.create({ user: uidA, deck: deckA._id, front: "A secret card", back: "hidden" });
        await Memory.create({ user: uidA, text: "User A prefers X over Y always", category: "preference" });

        // B cannot export A's chat
        expect((await request(app).get(`/api/v1/export/chat/${chatA._id}`).set(auth(ub.token))).status).toBe(404);
        // B's CSV contains no A cards
        const csv = await request(app).get("/api/v1/export/cards.csv").set(auth(ub.token));
        expect(csv.text).not.toContain("A secret card");
        // B's memory JSON is empty
        const memJson = await request(app).get("/api/v1/memories/export").set(auth(ub.token));
        expect(memJson.body.memories).toHaveLength(0);
        // B cannot scope-export A's deck
        expect((await request(app).get(`/api/v1/export/cards.csv?deck=${deckA._id}`).set(auth(ub.token))).status).toBe(404);
        // Unauthenticated → 401
        expect((await request(app).get(`/api/v1/export/chat/${chatA._id}`)).status).toBe(401);
        expect((await request(app).get("/api/v1/export/cards.csv")).status).toBe(401);
    });

    it("memory JSON export is owner-scoped and complete", async () => {
        const u = await createUser();
        const uid = (await mongoose.model("User").findOne({ email: u.email }))._id;
        await Memory.create({ user: uid, text: "User prefers evening work hours", category: "preference" });
        const r = await request(app).get("/api/v1/memories/export").set(auth(u.token));
        expect(r.status).toBe(200);
        expect(r.headers["content-disposition"]).toContain("quantum-memories.json");
        expect(r.body.count).toBe(1);
        expect(r.body.memories[0].text).toContain("evening work hours");
        expect(r.body.memories[0].embedding).toBeUndefined(); // no vectors in export
    });
});
