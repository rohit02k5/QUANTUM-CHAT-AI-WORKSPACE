const { defineConfig } = require("vitest/config");

module.exports = defineConfig({
    test: {
        environment: "node",
        globals: true,
        setupFiles: ["./tests/setup.js"],
        include: ["tests/**/*.test.js"],
        testTimeout: 30000,
        hookTimeout: 60000,
        // Files that require the app share one process — keep serial to avoid
        // clobbering each other's in-memory Mongo instance.
        fileParallelism: false,
    },
});
