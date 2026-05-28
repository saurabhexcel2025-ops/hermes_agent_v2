/** @jest-environment node */

import { execBaselineSchema } from "../helpers/baseline-db";

let testDb: import("better-sqlite3").Database | null = null;

function loadRealBetterSqlite3(): typeof import("better-sqlite3") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("better-sqlite3/lib/index.js") as typeof import("better-sqlite3");
}

jest.mock("@/lib/db", () => ({
  db: () => testDb!,
  ensureDb: () => undefined,
  uuid: () => "ch-cron-001",
  now: () => "2026-05-23T12:00:00.000Z",
}));

const mockReadHermesJobs = jest.fn();

jest.mock("fs", () => {
  const actual = jest.requireActual<typeof import("fs")>("fs");
  return {
    ...actual,
    existsSync: jest.fn(() => true),
    readFileSync: jest.fn((path: string) => {
      if (String(path).includes("jobs.json")) {
        return JSON.stringify({ jobs: mockReadHermesJobs() });
      }
      return actual.readFileSync(path, "utf-8");
    }),
  };
});

jest.mock("@/lib/hermes-agent-runtime", () => ({
  getActiveHermesPaths: () => ({
    root: "/tmp/hermes",
    cronJobs: "/tmp/hermes/cron/jobs.json",
    config: "/tmp/hermes/config.yaml",
  }),
}));

import { importHermesJobs } from "@/lib/cron/hermes-sync";

beforeEach(() => {
  const Database = loadRealBetterSqlite3();
  testDb = new Database(":memory:");
  execBaselineSchema(testDb);
  testDb
    .prepare(
      `INSERT INTO cron_jobs (
        id, name, prompt, skills, model, provider, base_url,
        schedule, schedule_display, repeat_json, enabled, state, deliver, script,
        profile_name, hermes_job_id, source, orphan, next_run_at, last_run_at,
        last_status, last_delivery_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "ch-cron-001",
      "Review",
      "prompt",
      "[]",
      "",
      "",
      null,
      '{"kind":"interval","minutes":5}',
      "every 5m",
      '{"times":null,"completed":0}',
      1,
      "scheduled",
      "none",
      null,
      "default",
      "hermes-job-1",
      "ch",
      0,
      null,
      null,
      null,
      null,
      "2026-05-01T00:00:00.000Z",
      "2026-05-01T00:00:00.000Z"
    );
});

afterEach(() => {
  testDb?.close();
  testDb = null;
  mockReadHermesJobs.mockReset();
});

describe("importHermesJobs repeat_json for CH-sourced jobs", () => {
  it("does not overwrite repeat_json when Hermes reports one-shot repeat", () => {
    mockReadHermesJobs.mockReturnValue([
      {
        id: "hermes-job-1",
        name: "Review",
        prompt: "prompt",
        schedule: { kind: "interval", minutes: 5, display: "every 5m" },
        repeat: { times: 1, completed: 1 },
        enabled: true,
        state: "scheduled",
        next_run_at: "2026-05-23T13:00:00.000Z",
        last_run_at: "2026-05-23T12:00:00.000Z",
        last_status: "error",
      },
    ]);

    importHermesJobs();

    const row = testDb!
      .prepare("SELECT repeat_json FROM cron_jobs WHERE id = ?")
      .get("ch-cron-001") as { repeat_json: string };

    expect(JSON.parse(row.repeat_json)).toEqual({ times: null, completed: 0 });
  });

  it("still imports execution fields from Hermes", () => {
    mockReadHermesJobs.mockReturnValue([
      {
        id: "hermes-job-1",
        name: "Review",
        prompt: "prompt",
        schedule: { kind: "interval", minutes: 5 },
        repeat: { times: 1, completed: 1 },
        enabled: true,
        state: "scheduled",
        next_run_at: "2026-05-23T13:00:00.000Z",
        last_run_at: "2026-05-23T12:00:00.000Z",
        last_status: "error",
        last_delivery_error: "delivery failed",
      },
    ]);

    importHermesJobs();

    const row = testDb!
      .prepare("SELECT last_status, last_delivery_error, next_run_at FROM cron_jobs WHERE id = ?")
      .get("ch-cron-001") as {
      last_status: string;
      last_delivery_error: string;
      next_run_at: string;
    };

    expect(row.last_status).toBe("error");
    expect(row.last_delivery_error).toBe("delivery failed");
    expect(row.next_run_at).toBe("2026-05-23T13:00:00.000Z");
  });
});
