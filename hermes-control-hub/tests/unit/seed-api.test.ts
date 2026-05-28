/** @jest-environment node */

jest.mock("@/lib/api-auth", () => ({
  requireAuth: jest.fn(() => null),
}));

jest.mock("@/lib/api-logger", () => ({ logApiError: jest.fn() }));

const mockImportHermesState = jest.fn(() => null);

jest.mock("@/lib/hermes-state-import", () => ({
  importHermesStateFromDisk: (...args: unknown[]) => mockImportHermesState(...args),
}));

const mockRunCatalogSeed = jest.fn(() => ({
  profiles: 6,
  templates: 12,
  categories: 6,
  pushed: 6,
}));

const mockGetSeedState = jest.fn(() => ({ lastRun: "2026-05-15T00:00:00.000Z" }));

jest.mock("@/lib/seed/catalog-seed", () => ({
  runCatalogSeed: (...args: unknown[]) => mockRunCatalogSeed(...args),
  getSeedState: () => mockGetSeedState(),
}));

describe("/api/seed", () => {
  beforeEach(() => jest.clearAllMocks());

  it("GET returns seed state", async () => {
    const { GET } = await import("@/app/api/seed/route");
    const res = await GET();
    const body = (await res.json()) as { data: { state: { lastRun: string } } };
    expect(body.data.state.lastRun).toBe("2026-05-15T00:00:00.000Z");
  });

  it("POST runs catalog seed with merge defaults", async () => {
    const { POST } = await import("@/app/api/seed/route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://localhost/api/seed", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    const body = (await res.json()) as { data: { profiles: number } };
    expect(body.data).toBeDefined();
    expect(body.data.profiles).toBe(6);
    expect(mockRunCatalogSeed).toHaveBeenCalledWith(
      expect.objectContaining({ target: "all", mode: "merge" }),
    );
  });
});
