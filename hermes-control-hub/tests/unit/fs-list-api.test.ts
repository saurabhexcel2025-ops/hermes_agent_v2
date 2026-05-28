/** @jest-environment node */

import { NextRequest } from "next/server";

const mockResolveAllowed = jest.fn();

jest.mock("@/lib/path-security", () => ({
  resolveAllowedWorkspacePath: (input: string) => mockResolveAllowed(input),
}));

jest.mock("@/lib/api-logger", () => ({
  logApiError: jest.fn(),
}));

const mockExistsSync = jest.fn();
const mockStatSync = jest.fn();
const mockReaddirSync = jest.fn();

jest.mock("fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args) as boolean,
  statSync: (...args: unknown[]) => mockStatSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args) as string[],
}));

jest.mock("os", () => ({
  homedir: () => "/home/tester",
}));

describe("GET /api/fs/list", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns entries for an allowed directory", async () => {
    mockResolveAllowed.mockReturnValue({ ok: true, absolute: "/home/tester/proj" });
    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockImplementation((p: string) => ({
      isDirectory: () => String(p).endsWith("proj") || String(p).endsWith("sub"),
      isFile: () => String(p).endsWith("readme"),
    }));
    mockReaddirSync.mockReturnValue(["readme", "sub"]);

    const { GET } = await import("@/app/api/fs/list/route");
    const res = await GET(
      new NextRequest("http://localhost/api/fs/list?path=/home/tester/proj"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.path).toBe("/home/tester/proj");
    expect(body.data.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "sub", isDir: true }),
        expect.objectContaining({ name: "readme", isFile: true }),
      ]),
    );
  });

  it("rejects paths outside the allowed workspace policy", async () => {
    mockResolveAllowed.mockReturnValue({
      ok: false,
      error: "Path must be under your home directory, Control Hub data, or a registered agent root",
    });

    const { GET } = await import("@/app/api/fs/list/route");
    const res = await GET(
      new NextRequest("http://localhost/api/fs/list?path=/etc/passwd"),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Path must be under/);
  });
});
