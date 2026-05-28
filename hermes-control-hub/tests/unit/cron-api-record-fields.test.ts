/* eslint-disable @typescript-eslint/no-require-imports */
/** @jest-environment node */

jest.mock("@/lib/api-auth", () => ({ requireAuth: jest.fn(() => null) }));
jest.mock("@/lib/api-logger", () => ({ logApiError: jest.fn() }));
jest.mock("@/lib/cron-repository", () => ({
  listCronJobs: jest.fn(() => [
    {
      id: "job-1",
      name: "Test",
      prompt: "p",
      skills: [],
      model: "m",
      provider: "p",
      base_url: null,
      schedule: "{}",
      schedule_display: "every 5m",
      repeat: { times: null, completed: 0 },
      enabled: true,
      state: "scheduled",
      deliver: "none",
      script: "",
      profile_name: "default",
      next_run_at: null,
      last_run_at: null,
      last_status: null,
      hermes_job_id: null,
      source: "ch",
      orphan: true,
      created_at: "2026-01-01T00:00:00Z",
    },
  ]),
  importHermesJobs: jest.fn(() => ({ errors: [] })),
}));

describe("GET /api/cron — recordToApiJob fields", () => {
  it("includes orphan and repeat in API response", async () => {
    const { GET } = require("@/app/api/cron/route") as {
      GET: () => Promise<{ json(): Promise<{ data: { jobs: Array<Record<string, unknown>> } }> }>;
    };

    const req = new Request("http://localhost/api/cron");
    const res = await GET(req);
    const body = await res.json();
    const job = body.data.jobs[0];

    expect(job.orphan).toBe(true);
    expect(job.repeat).toEqual({ times: null, completed: 0 });
  });
});
