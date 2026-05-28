import { formatApiError } from "@/lib/api-fetch";

describe("formatApiError", () => {
  it("returns base error when cronPushError is absent", () => {
    expect(formatApiError({ error: "Not found" }, "HTTP 404")).toBe("Not found");
  });

  it("appends cronPushError when present", () => {
    expect(
      formatApiError(
        { error: "Failed to sync cron job to Hermes", cronPushError: "venv missing" },
        "HTTP 502",
      ),
    ).toBe("Failed to sync cron job to Hermes: venv missing");
  });
});
