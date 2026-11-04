const mongoose = require("mongoose");
const { request, app, createUser, auth } = require("./helpers");
const File = require("../models/File");
const fs = require("fs");
const path = require("path");

describe("file privacy + health", () => {
    it("rejects unauthenticated upload/view/list", async () => {
        expect((await request(app).get("/api/v1/files/list")).status).toBe(401);
        expect((await request(app).post("/api/v1/files/upload")).status).toBe(401);
        expect((await request(app).get(`/api/v1/files/${new mongoose.Types.ObjectId()}/view`)).status).toBe(401);
    });

    it("streams an owned file and rejects others' files", async () => {
        const a = await createUser();
        const b = await createUser();
        const aUser = await mongoose.connection.collection("users").findOne({ email: a.email });

        const tmpDir = path.join(__dirname, "tmp");
        fs.mkdirSync(tmpDir, { recursive: true });
        const tmpPath = path.join(tmpDir, "owned.txt");
        fs.writeFileSync(tmpPath, "owned content");

        const file = await File.create({
            user: aUser._id, filename: "owned.txt", originalName: "owned.txt",
            path: tmpPath, mimetype: "text/plain",
        });

        const ok = await request(app).get(`/api/v1/files/${file._id}/view`).set(auth(a.token));
        expect(ok.status).toBe(200);
        expect(ok.text).toBe("owned content");

        const denied = await request(app).get(`/api/v1/files/${file._id}/view`).set(auth(b.token));
        expect(denied.status).toBe(404);
    });

    it("GET /health reports db ok + model config", async () => {
        const res = await request(app).get("/health");
        expect(res.status).toBe(200);
        expect(res.body.db.ok).toBe(true);
        expect(res.body.models.embeddingDims).toBe(768);
        expect(res.body).toHaveProperty("uptimeSec");
    });
});
