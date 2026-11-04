const { AsyncLocalStorage } = require("async_hooks");

// Per-request context propagated through the async call stack.
// Anything (e.g. geminiHelper usage instrumentation) can read the
// active requestId/userId without threading it through every call.
const als = new AsyncLocalStorage();

module.exports = {
    als,
    getRequestId: () => als.getStore()?.requestId,
    getUserId: () => als.getStore()?.userId,
};
