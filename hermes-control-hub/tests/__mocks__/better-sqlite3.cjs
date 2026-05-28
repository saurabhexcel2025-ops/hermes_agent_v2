// tests/__mocks__/better-sqlite3.cjs
// Mapped via moduleNameMapper in jest.config.js — redirects all
// "better-sqlite3" imports to this file instead of the real native module.
//
// The real better-sqlite3 uses CJS `require('fs')` at module evaluation time,
// which fails when any test file has done `jest.mock("fs")`.
// This pure CJS mock prevents native addon loading entirely.
//
// Individual tests that need specific mock behavior should additionally mock
// "@/lib/db" to return per-test mock values.
//
// NOTE: Must be .cjs (CommonJS) because the real module is CJS and ESM mocking
// of CJS modules with internal require() calls is unreliable in Jest.

'use strict';

const mockPrepare = function mockPrepare() {
  return {
    run: function run() { return {}; },
    get: function get() { return undefined; },
    all: function all() { return []; },
  };
};

const mockDb = {
  pragma: function pragma() { return []; },
  exec: function exec() { return undefined; },
  prepare: mockPrepare,
  transaction: function transaction(fn) { return fn(); },
  close: function close() { return undefined; },
};

module.exports = mockDb;
module.exports.default = mockDb;
module.exports.SqliteError = class SqliteError extends Error {
  constructor(message) { super(message); this.name = 'SqliteError'; }
};
