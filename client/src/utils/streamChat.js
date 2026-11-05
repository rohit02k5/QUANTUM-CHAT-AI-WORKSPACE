// SSE client for POST /api/v1/chat/:chatId/stream.
// Uses fetch + ReadableStream (EventSource can't send Authorization headers).
// On 401 it performs one silent token refresh — mirroring axiosConfig's
// interceptor — then retries once.

const API_BASE = (process.env.REACT_APP_API_URL || (process.env.NODE_ENV === "production"
    ? "https://quantum-chat-backend.onrender.com"
    : "http://localhost:8080")).trim();

const getToken = () => localStorage.getItem("authToken") || sessionStorage.getItem("authToken");
const getStorage = () => (localStorage.getItem("authToken") ? localStorage : sessionStorage);

async function refreshTokenOnce() {
    const store = getStorage();
    const refreshToken = store.getItem("refreshToken");
    if (!refreshToken) return null;
    const res = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.token) return null;
    store.setItem("authToken", data.token);
    if (data.refreshToken) store.setItem("refreshToken", data.refreshToken);
    return data.token;
}

/**
 * @param {Object} opts
 * @param {string|null} opts.chatId  existing chat id or null/"new"
 * @param {Object} opts.body         {message, fileId?, useDocuments?, documentIds?}
 * @param {function(Object):void} opts.onEvent  called per SSE event {type: meta|token|done|error, ...}
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ok:boolean, refused?:boolean}>} refused=true means stream
 *   failed before any event arrived — caller should fall back to /message.
 */
export async function streamChat({ chatId, body, onEvent, signal }) {
    const doFetch = () =>
        fetch(`${API_BASE}/api/v1/chat/${chatId || "new"}/stream`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${getToken()}`,
            },
            body: JSON.stringify(body),
            signal,
        });

    let res = await doFetch();

    if (res.status === 401) {
        const newToken = await refreshTokenOnce();
        if (!newToken) return { ok: false, refused: true };
        res = await doFetch();
    }

    if (!res.ok || !res.body) return { ok: false, refused: true };
    return readSse(res.body, onEvent);
}

/** Shared SSE reader — used by live streams and recorded replays alike. */
async function readSse(body, onEvent) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let sawEvent = false;

    const emit = (block) => {
        if (!block.startsWith("data:")) return;
        try {
            const evt = JSON.parse(block.slice(5).trim());
            sawEvent = true;
            onEvent(evt);
        } catch {
            /* malformed event — skip */
        }
    };

    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const blocks = buffer.split("\n\n");
            buffer = blocks.pop() || "";
            for (const b of blocks) emit(b);
        }
        if (buffer) emit(buffer);
    } catch (err) {
        if (err.name === "AbortError") return { ok: true, aborted: true };
        return { ok: false, refused: !sawEvent };
    }
    return { ok: true, refused: false };
}

/**
 * Stream a recorded demo replay (GET /api/v1/demo/replay/:id) through the
 * SAME SSE reader as live streams. Events are labelled replay:true — the UI
 * must show "Recorded replay, not a live model call".
 */
export async function streamReplay({ scenario, onEvent, signal }) {
    const doFetch = () =>
        fetch(`${API_BASE}/api/v1/demo/replay/${scenario}`, {
            method: "GET",
            headers: { Authorization: `Bearer ${getToken()}` },
            signal,
        });
    let res = await doFetch();
    if (res.status === 401) {
        const newToken = await refreshTokenOnce();
        if (!newToken) return { ok: false, refused: true };
        res = await doFetch();
    }
    if (!res.ok || !res.body) return { ok: false, refused: true };
    return readSse(res.body, onEvent);
}
