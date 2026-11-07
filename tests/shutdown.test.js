/**
 * shutdown.test.js — Phase 6.3 graceful-shutdown mechanics.
 * server.js wires SIGTERM → sseRegistry.closeAll() + jobRunner.stopRunner()
 * + mongoose.disconnect(); these tests prove those units do their part.
 */
const { EventEmitter } = require("events");

describe("graceful shutdown (6.3)", () => {
    test("sseRegistry.closeAll ends open streams with a final event", () => {
        const { register, closeAll, _size } = require("../utils/sseRegistry");
        const chunks = [];
        const res = new EventEmitter();
        res.writableEnded = false;
        res.write = (d) => chunks.push(d);
        res.end = () => { res.writableEnded = true; res.emit("finish"); };

        register(res);
        expect(_size()).toBe(1);
        closeAll();
        expect(res.writableEnded).toBe(true);
        expect(_size()).toBe(0);
        const last = chunks[chunks.length - 1];
        expect(last).toContain("server-shutdown");
        expect(last.startsWith("data: ")).toBe(true);
    });

    test("closeAll tolerates already-ended streams", () => {
        const { register, closeAll } = require("../utils/sseRegistry");
        const res = new EventEmitter();
        res.writableEnded = true;
        res.write = () => { throw new Error("should not be called"); };
        res.end = () => {};
        register(res);
        expect(() => closeAll()).not.toThrow();
    });

    test("jobRunner.stopRunner releases a claimed job back to queued", async () => {
        const mongoose = require("mongoose");
        if (mongoose.connection.readyState !== 1) return; // skip without DB
        const IngestionJob = require("../models/IngestionJob");
        const File = require("../models/File");
        const User = require("../models/userModel");
        const jobRunner = require("../utils/jobRunner");

        const u = await User.create({ username: "shutdown-t", email: "shutdown-t@test.dev", password: "x".repeat(20) });
        const f = await File.create({ user: u._id, filename: "x.txt", originalName: "x.txt", path: "/tmp/x", mimetype: "text/plain", status: "processing" });
        const job = await IngestionJob.create({ user: u._id, file: f._id, status: "queued" });

        const claimed = await jobRunner.claimNext();
        expect(claimed?._id?.toString()).toBe(job._id.toString());
        expect(claimed.status).toBe("processing");
        jobRunner.runner.active.add(claimed._id.toString()); // what tick() does

        await jobRunner.stopRunner();
        const after = await IngestionJob.findById(job._id);
        expect(after.status).toBe("queued");
        expect(after.lockedAt == null).toBe(true);

        await IngestionJob.deleteMany({ user: u._id });
        await File.deleteMany({ user: u._id });
        await User.deleteOne({ _id: u._id });
    });
});
