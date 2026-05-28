/** @jest-environment node */
import { NextRequest } from "next/server";

// We test the route handler directly by importing it
// and verifying its behavior through the exported PUT function.

describe("personality route security", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ── Read-only mode ───────────────────────────────────────────

  it("rejects writes when CH_READ_ONLY is set", async () => {
    process.env.CH_READ_ONLY = "true";
    const { PUT } = await import("@/app/api/agent/personality/route");

    const request = new NextRequest("http://localhost/api/agent/personality", {
      method: "PUT",
      body: JSON.stringify({ personality: "friendly" }),
    });

    const response = await PUT(request);
    expect(response.status).toBe(503);
  });

  // ── Path traversal prevention ─────────────────────────────────

  it("rejects profile names with path traversal (../)", async () => {
    delete process.env.CH_READ_ONLY;
    const { PUT } = await import("@/app/api/agent/personality/route");

    const request = new NextRequest("http://localhost/api/agent/personality", {
      method: "PUT",
      body: JSON.stringify({ profile: "../etc", personality: "friendly" }),
    });

    const response = await PUT(request);
    // resolveSafeProfileName rejects ".." in the name
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/invalid/i);
  });

  it("rejects profile names with slashes", async () => {
    delete process.env.CH_READ_ONLY;
    const { PUT } = await import("@/app/api/agent/personality/route");

    const request = new NextRequest("http://localhost/api/agent/personality", {
      method: "PUT",
      body: JSON.stringify({ profile: "foo/bar", personality: "friendly" }),
    });

    const response = await PUT(request);
    expect(response.status).toBe(400);
  });

  it("rejects empty personality", async () => {
    delete process.env.CH_READ_ONLY;
    const { PUT } = await import("@/app/api/agent/personality/route");

    const request = new NextRequest("http://localhost/api/agent/personality", {
      method: "PUT",
      body: JSON.stringify({ personality: "" }),
    });

    const response = await PUT(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/personality is required/i);
  });
});
