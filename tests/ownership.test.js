const mongoose = require("mongoose");
const { request, app, createUser, auth } = require("./helpers");
const Chat = require("../models/Chat");
const File = require("../models/File");
const Chunk = require("../models/Chunk");

describe("ownership isolation", () => {
    it("user B cannot read, delete, search, or stream user A's resources", async () => {
        const a = await createUser();
        const b = await createUser();

        const aUser = await mongoose.connection.collection("users").findOne({ email: a.email });

        // Seed A's chat, file, chunk directly
        const chat = await Chat.create({
            user: aUser._id,
            title: "A secret chat",
            messages: [{ role: "user", content: "secret" }],
        });
        const file = await File.create({
            user: aUser._id,
            filename: "f.txt",
            originalName: "f.txt",
            path: "uploads/nonexistent.txt",
            mimetype: "text/plain",
            content: "SIM:aaaa A's private doc",
        });
        await Chunk.create({
            user: aUser._id,
            file: file._id,
            text: "SIM:aaaa secret chunk",
            embedding: new Array(768).fill(0.1),
            embeddingDims: 768,
        });

        // B reads A's chat -> 404
        const chatRes = await request(app).get(`/api/v1/chat/${chat._id}`).set(auth(b.token));
        expect(chatRes.status).toBe(404);

        // B deletes A's chat -> not found/ok but chat still exists
        await request(app).delete(`/api/v1/chat/${chat._id}`).set(auth(b.token));
        expect(await Chat.findById(chat._id)).toBeTruthy();

        // B streams A's file -> 404
        const viewRes = await request(app).get(`/api/v1/files/${file._id}/view`).set(auth(b.token));
        expect(viewRes.status).toBe(404);

        // B deletes A's file -> file still exists
        await request(app).delete(`/api/v1/files/${file._id}`).set(auth(b.token));
        expect(await File.findById(file._id)).toBeTruthy();

        // B's global search never sees A's content
        const search = await request(app).get("/api/v1/search?query=secret").set(auth(b.token));
        expect(search.body.files).toHaveLength(0);
        expect(search.body.chats).toHaveLength(0);

        // B's file list is empty
        const list = await request(app).get("/api/v1/files/list").set(auth(b.token));
        expect(list.body.files).toHaveLength(0);

        // B's studio calls can't reference A's file
        const flash = await request(app)
            .post("/api/v1/studio/flashcards")
            .set(auth(b.token))
            .send({ fileId: file._id.toString() });
        expect(flash.status).toBe(404);

        // B's mindmap call can't target A's chat
        const mm = await request(app).post("/api/v1/chat/mindmap").set(auth(b.token)).send({ chatId: chat._id.toString() });
        expect(mm.status).toBe(404);
    });
});
