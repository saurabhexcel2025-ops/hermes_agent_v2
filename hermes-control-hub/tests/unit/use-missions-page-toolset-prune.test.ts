/** @jest-environment node */

import { readFileSync } from "fs";
import { join } from "path";

const hookPath = join(__dirname, "..", "..", "src", "hooks", "useMissionsPage.ts");

describe("useMissionsPage profile toolset prune", () => {
  it("filters suggested toolsets when profile changes", () => {
    const content = readFileSync(hookPath, "utf-8");
    expect(content).toContain("/api/agent/profiles/${slug}/toolsets");
    expect(content).toContain("setNewToolsets((prev) => prev.filter((t) => toolsetIds.has(t)))");
    expect(content).toContain("unionToolsetsFromPlatforms(");
  });
});
