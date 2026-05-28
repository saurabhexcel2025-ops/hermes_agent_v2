/** @jest-environment node */

import { NextRequest } from "next/server";

const mockResolveAllowed = jest.fn();
const mockReadGit = jest.fn();

jest.mock("@/lib/path-security", () => ({
  resolveAllowedWorkspacePath: (input: string) => mockResolveAllowed(input),
}));

jest.mock("@/lib/git-workspace-branches", () => ({
  readGitBranchMetadataForWorkspacePath: (abs: string) => mockReadGit(abs),
}));

jest.mock("@/lib/api-logger", () => ({
  logApiError: jest.fn(),
}));

describe("GET /api/fs/git/branches (route)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveAllowed.mockReturnValue({ ok: true, absolute: "/home/tester/repo" });
  });

  it("requires path query param", async () => {
    const { GET } = await import("@/app/api/fs/git/branches/route");
    const res = await GET(new NextRequest("http://localhost/api/fs/git/branches"));
    expect(res.status).toBe(400);
    expect(mockReadGit).not.toHaveBeenCalled();
  });

  it("returns 400 when path is not allowed", async () => {
    mockResolveAllowed.mockReturnValue({ ok: false, error: "Path must be under home" });
    const { GET } = await import("@/app/api/fs/git/branches/route");
    const res = await GET(
      new NextRequest("http://localhost/api/fs/git/branches?path=/etc"),
    );
    expect(res.status).toBe(400);
    expect(mockReadGit).not.toHaveBeenCalled();
  });

  it("delegates to readGitBranchMetadataForWorkspacePath and returns data", async () => {
    mockReadGit.mockResolvedValue({
      isGitRepo: true,
      branches: ["main"],
      current: "main",
    });
    const { GET } = await import("@/app/api/fs/git/branches/route");
    const res = await GET(
      new NextRequest("http://localhost/api/fs/git/branches?path=/home/tester/repo"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({
      isGitRepo: true,
      branches: ["main"],
      current: "main",
    });
    expect(mockReadGit).toHaveBeenCalledWith("/home/tester/repo");
  });
});
