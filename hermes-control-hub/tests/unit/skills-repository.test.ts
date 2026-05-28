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
  now: () => "2026-01-01T00:00:00.000Z",
}));

import { getSkill, listSkills, upsertSkill } from "@/lib/skills-repository";

beforeEach(() => {
  const Database = loadRealBetterSqlite3();
  testDb = new Database(":memory:");
  execBaselineSchema(testDb);
});

afterEach(() => {
  testDb?.close();
  testDb = null;
});

describe("skills-repository", () => {
  it("upserts and lists skills by key", () => {
    upsertSkill({
      skillKey: "github/git-workflow",
      displayName: "Git Workflow",
      description: "Git helpers",
      category: "github",
      content: "---\nname: git-workflow\n---\n",
      source: "custom",
    });

    const row = getSkill("github/git-workflow");
    expect(row?.displayName).toBe("Git Workflow");
    expect(listSkills().some((s) => s.skillKey === "github/git-workflow")).toBe(true);
  });
});
