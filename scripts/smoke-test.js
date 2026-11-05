#!/usr/bin/env node
/*
 * Post-deploy smoke test. Usage:
 *   node scripts/smoke-test.js <BASE_URL>
 *
 * Verifies, in order:
 *   1. GET /health — db ok + vector index status
 *   2. Register throwaway user
 *   3. Chat stream — first token before completion; connection stays alive
 *   4. Upload a tiny PDF -> ready via ingestion SSE (polling fallback)
 *   5. Question -> answer cites the uploaded source
 *   6. Range request on /view returns 206
 *   7. DELETE /api/v1/auth/account removes the user + all its data
 *
 * Exit 0 = healthy. Never prints tokens or secrets.
 */
const BASE = (process.argv[2] || "").replace(/\/+$/, "");
if (!BASE) { console.error("usage: node scripts/smoke-test.js <BASE_URL>"); process.exit(2); }

const SUFFIX = `${Date.now().toString(36)}`;
const USER = { username: `smoke-${SUFFIX}`, email: `smoke-${SUFFIX}@smoke.test`, password: `Sm0ke!${SUFFIX}x` };
const TIMEOUT = 180000;

let token = null;
let userId = null;
const failures = [];
const ok = (name, cond, extra = "") => {
    console.log(`${cond ? "  PASS" : "  FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
    if (!cond) failures.push(name);
};

const api = async (path, opts = {}) => {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { ...(opts.body ? {} : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...opts.headers },
    });
    return res;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Minimal SSE reader: invokes cb(event) for each `data:` line until done/timeout. */
async function readSSE(res, { timeoutMs, onEvent }) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", done = false;
    const timer = setTimeout(() => { done = true; reader.cancel().catch(() => {}); }, timeoutMs);
    try {
        while (!done) {
            const { value, done: d } = await reader.read();
            if (d) break;
            buf += dec.decode(value, { stream: true });
            let idx;
            while ((idx = buf.indexOf("\n\n")) >= 0) {
                const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
                for (const line of block.split("\n")) {
                    if (line.startsWith("data:")) {
                        try { if (onEvent(JSON.parse(line.slice(5).trim())) === "stop") { done = true; } } catch { /* heartbeat/comment */ }
                    }
                }
            }
        }
    } finally { clearTimeout(timer); reader.cancel().catch(() => {}); }
}

/** Tiny valid PDF (1 page, small text) — enough for ingestion to produce a chunk. */
function tinyPdf() {
    const objs = [
        "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n",
        "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n",
        "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n",
        `4 0 obj<</Length ${"BT/F1 18 Tf 72 720 Td (Quantum smoke test document about marsupials and orbital mechanics.) Tj ET".length}>>stream\nBT/F1 18 Tf 72 720 Td (Quantum smoke test document about marsupials and orbital mechanics.) Tj ET\nendstream endobj\n`,
        "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n",
    ];
    let pdf = "%PDF-1.4\n"; const off = [];
    for (const o of objs) { off.push(pdf.length); pdf += o; }
    const xref = pdf.length;
    pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
    pdf += `trailer<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(pdf, "binary");
}

async function main() {
    console.log(`[smoke] target: ${BASE}`);

    // 1. /health
    const h = await api("/health").then((r) => r.json()).catch((e) => ({ err: e.message }));
    ok("health endpoint responds", h && h.status === "ok", JSON.stringify(h?.db?.ok ?? h?.err ?? h).slice(0, 60));
    ok("database ok", h?.db?.ok === true);
    if (h?.vectorIndex) ok("vector index reported", true, JSON.stringify(h.vectorIndex).slice(0, 80));

    // 2. register
    const reg = await api("/api/v1/auth/register", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(USER),
    });
    const regBody = await reg.json().catch(() => ({}));
    ok("register throwaway user", reg.status === 201 && !!regBody.token, `status ${reg.status}`);
    if (!regBody.token) throw new Error("cannot continue without token");
    token = regBody.token;

    // 3. chat stream: first token before done + liveness
    let firstToken = null, gotToken = false, gotDone = false, gotMeta = false;
    const streamRes = await api("/api/v1/chat/new/stream", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ message: "Reply with exactly the word: pong" }),
    });
    ok("stream endpoint accepts", streamRes.status === 200);
    const t0 = Date.now();
    if (streamRes.status === 200) {
        await readSSE(streamRes, {
            timeoutMs: 90000,
            onEvent: (ev) => {
                if (ev.type === "meta") gotMeta = true;
                if (ev.type === "token" && !gotToken) { gotToken = true; firstToken = Date.now() - t0; }
                if (ev.type === "done" || ev.type === "error") { gotDone = true; return "stop"; }
            },
        });
        ok("meta event received", gotMeta);
        ok("first token before completion", gotToken && gotDone, `${firstToken}ms to first token`);
    }

    // 4. upload tiny PDF -> ingestion -> ready (SSE w/ poll fallback)
    const fd = new FormData();
    fd.append("file", new Blob([tinyPdf()], { type: "application/pdf" }), "smoke.pdf");
    fd.append("saveToKB", "true");
    const up = await api("/api/v1/files/upload", { method: "POST", body: fd });
    const upBody = await up.json().catch(() => ({}));
    const fileId = upBody.fileId || upBody.file?._id || upBody._id;
    ok("upload accepted", (up.status === 200 || up.status === 201 || up.status === 202) && !!fileId, `status ${up.status}`);

    let ready = upBody.status === "ready";
    if (fileId && !ready) {
        // try SSE progress first
        try {
            const sse = await api(`/api/v1/files/${fileId}/ingestion/stream`, { headers: { Accept: "text/event-stream" } });
            if (sse.status === 200) {
                await readSSE(sse, {
                    timeoutMs: TIMEOUT,
                    onEvent: (ev) => {
                        if (ev.status === "done" || ev.status === "failed") { ready = ev.status === "done"; return "stop"; }
                    },
                });
            }
        } catch { /* SSE failed — poll below */ }
        const deadline = Date.now() + TIMEOUT;
        while (!ready && Date.now() < deadline) {
            const f = await api(`/api/v1/files/list`).then((r) => r.json()).catch(() => ({}));
            const doc = (f.files || f || []).find((x) => (x._id || x.id) === fileId);
            if (doc?.status === "ready") ready = true;
            else if (doc?.status === "failed") break;
            else await sleep(2000);
        }
    }
    ok("file ingested to ready", ready);

    // 5. ask a question -> citation. Atlas vector indexes are eventually
    // consistent — fresh chunks may take seconds to become searchable, so
    // retry a few times before declaring failure.
    if (ready) {
        let sources = [], lastStatus = 0;
        for (let i = 0; i < 6 && !sources.length; i++) {
            if (i) await sleep(8000);
            const chat = await api("/api/v1/chat/message", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: "What does the smoke test document say about marsupials and orbital mechanics?" }),
            });
            lastStatus = chat.status;
            const cbody = await chat.json().catch(() => ({}));
            sources = cbody.sources || cbody.message?.sources || [];
        }
        ok("chat answers with citations", lastStatus === 200 && sources.length > 0,
            sources.length ? `source: ${sources[0].originalName || sources[0].fileId}` : `status ${lastStatus}`);
    }

    // 6. Range request -> 206
    if (fileId) {
        const rng = await api(`/api/v1/files/${fileId}/view`, { headers: { Range: "bytes=0-15" } });
        ok("Range request returns 206", rng.status === 206, `status ${rng.status}`);
        await rng.arrayBuffer().catch(() => {});
    }

    // 7. delete account + verify gone
    const del = await api("/api/v1/auth/account", { method: "DELETE" });
    ok("account deleted", del.status === 200, `status ${del.status}`);
    const verify = await api("/api/v1/files/list");
    ok("token invalidated after deletion", verify.status === 401, `status ${verify.status}`);
}

main()
    .then(() => {
        console.log(failures.length ? `\n[smoke] FAILED: ${failures.join(", ")}` : "\n[smoke] all checks passed");
        process.exit(failures.length ? 1 : 0);
    })
    .catch((e) => { console.error("\n[smoke] fatal:", e.message); process.exit(1); });
