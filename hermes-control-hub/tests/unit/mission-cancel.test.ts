/* eslint-disable @typescript-eslint/no-require-imports */
/** @jest-environment node */

import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

const killCalls: Array<{ pid: number; signal: NodeJS.Signals }> = [];
const execCalls: string[] = [];

jest.mock("child_process", () => ({
  spawn: jest.fn(),
  execSync: jest.fn((cmd: string) => {
    execCalls.push(cmd);
    return "";
  }),
}));

jest.mock("@/lib/paths", () => {
  const actualOs = jest.requireActual("os") as typeof import("os");
  const actualFs = jest.requireActual("fs") as typeof import("fs");
  const actualPath = jest.requireActual("path") as typeof import("path");
  const root = actualFs.mkdtempSync(actualPath.join(actualOs.tmpdir(), "ch-cancel-"));
  return {
    PATHS: { missions: actualPath.join(root, "missions") },
    CH_DATA_DIR: root,
    __TEST_TMP_ROOT__: root,
  };
});

const originalPlatform = process.platform;

beforeAll(() => {
  Object.defineProperty(process, "platform", { value: "linux" });
});

afterAll(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform });
});

beforeEach(() => {
  killCalls.length = 0;
  execCalls.length = 0;
  jest.spyOn(process, "kill").mockImplementation((pid, signal) => {
    killCalls.push({ pid: pid as number, signal: signal as NodeJS.Signals });
    if (signal === 0) {
      const lastTerm = [...killCalls]
        .reverse()
        .find((c) => c.signal === "SIGTERM" || c.signal === "SIGKILL");
      if (lastTerm) {
        const err = new Error("ESRCH") as NodeJS.ErrnoException;
        err.code = "ESRCH";
        throw err;
      }
    }
    return true;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  const paths = require("@/lib/paths") as { __TEST_TMP_ROOT__?: string };
  const root = paths.__TEST_TMP_ROOT__;
  if (root && existsSync(root)) rmSync(root, { recursive: true, force: true });
});

describe("cancelMissionProcess", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("writes cancelled status.json and removes pid file", async () => {
    const { PATHS } = require("@/lib/paths") as { PATHS: { missions: string } };
    require("fs").mkdirSync(PATHS.missions, { recursive: true });
    const missionId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    writeFileSync(
      join(PATHS.missions, `${missionId}.pid.json`),
      JSON.stringify({ pid: 9999, startedAt: "2026-01-01T00:00:00Z" }),
    );

    const { cancelMissionProcess } = require("@/lib/backends/hermes") as {
      cancelMissionProcess: (id: string) => Promise<{ processKilled: boolean; error: string | null }>;
    };

    const resultPromise = cancelMissionProcess(missionId);
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.processKilled).toBe(true);
    expect(result.error).toBeNull();

    const statusPath = join(PATHS.missions, `${missionId}.status.json`);
    expect(existsSync(statusPath)).toBe(true);
    const status = JSON.parse(readFileSync(statusPath, "utf-8")) as {
      status: string;
      error: string;
    };
    expect(status.status).toBe("failed");
    expect(status.error).toBe("Cancelled by user");
    expect(existsSync(join(PATHS.missions, `${missionId}.pid.json`))).toBe(false);

    expect(killCalls.some((c) => c.signal === "SIGTERM")).toBe(true);
    expect(execCalls.some((c) => c.includes("CH_MISSION_ID="))).toBe(true);
  });

  it("falls back to pkill when pid file is missing", async () => {
    const { cancelMissionProcess } = require("@/lib/backends/hermes") as {
      cancelMissionProcess: (id: string) => Promise<{ processKilled: boolean }>;
    };

    const resultPromise = cancelMissionProcess("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.processKilled).toBe(true);
    expect(execCalls.some((c) => c.includes("pkill"))).toBe(true);
    expect(killCalls.length).toBe(0);
  });
});
