const pino = require("pino");

// Central logger. JSON in production (machine-parseable on Render),
// pretty-printed in development.
const isProd = process.env.NODE_ENV === "production";

const logger = pino(
    {
        level: process.env.LOG_LEVEL || (isProd ? "info" : "debug"),
        base: { app: "quantum-ai", version: require("../package.json").version },
        // Never log these, even by accident
        redact: {
            paths: [
                "req.headers.authorization",
                "req.headers.cookie",
                "*.token",
                "*.refreshToken",
                "*.password",
                "*.apiKey",
                "*.GEMINI_API_KEY",
            ],
            censor: "[redacted]",
        },
    },
    isProd
        ? undefined
        : pino.transport({
              target: "pino-pretty",
              options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
          })
);

module.exports = logger;
