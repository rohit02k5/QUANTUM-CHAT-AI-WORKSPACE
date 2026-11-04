const crypto = require("crypto");
const { als } = require("../utils/requestContext");
const logger = require("../utils/logger");

// Assigns/propagates x-request-id and opens an AsyncLocalStorage scope
// for the rest of the request. Logs one line per request (like morgan,
// but structured and correlation-ready).
module.exports = function requestId(req, res, next) {
    const id = req.headers["x-request-id"] || crypto.randomUUID();
    req.id = id;
    res.setHeader("x-request-id", id);

    const start = process.hrtime.bigint();
    als.run({ requestId: id, userId: req.user?._id }, () => {
        res.on("finish", () => {
            const ms = Number(process.hrtime.bigint() - start) / 1e6;
            logger.info(
                {
                    requestId: id,
                    method: req.method,
                    url: req.originalUrl,
                    status: res.statusCode,
                    ms: Math.round(ms),
                },
                "request"
            );
        });
        next();
    });
};
