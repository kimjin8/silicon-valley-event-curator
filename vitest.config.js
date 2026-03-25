// ============================================================
// vitest.config.js — Test runner configuration
// ============================================================

const { defineConfig } = require("vitest/config");

module.exports = defineConfig({
  test: {
    // Use Node.js environment (not browser)
    environment: "node",
    // Make describe, it, expect available globally without importing
    globals: true,
    // Show verbose test output
    reporters: ["verbose"],
    // Timeout for each test (in milliseconds)
    testTimeout: 10000,
  },
});
