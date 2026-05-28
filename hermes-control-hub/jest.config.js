/* eslint-disable @typescript-eslint/no-require-imports -- Jest config is CommonJS */
const nextJest = require("next/jest.js");

const createJestConfig = nextJest({ dir: "./" });

/** Unit tests live under `tests/unit/**`. */
const config = {
  testEnvironment: "jest-environment-jsdom",
  setupFilesAfterEnv: ["<rootDir>/tests/jest.setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    // Intercept better-sqlite3 at resolution time so the real CJS module
    // (which calls require('fs') at evaluation time) is never loaded.
    // The mock exports a minimal Database-compatible object with prepare/run/get/all.
    "^better-sqlite3$": "<rootDir>/tests/__mocks__/better-sqlite3.cjs",
  },
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.d.ts",
    "!src/**/layout.tsx",
    "!src/**/page.tsx",
    "!src/app/**",
  ],
  coverageThreshold: {
    global: {
      branches: 8,
      functions: 5,
      lines: 10,
      statements: 10,
    },
    "src/lib/": {
      branches: 12,
      functions: 8,
      lines: 15,
      statements: 15,
    },
  },
  testMatch: [
    "<rootDir>/tests/unit/**/*.test.ts",
    "<rootDir>/tests/unit/**/*.test.tsx",
  ],
};

module.exports = createJestConfig(config);
