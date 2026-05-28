import { parseSchedule } from "@/lib/schedule/parse-schedule";

/**
 * Contract tests for Hermes-aligned schedule strings used with `jobs.json`.
 */
describe("parseSchedule (Hermes schedule surface)", () => {
  it("accepts Hermes-style every-Nm / every-Nh", () => {
    expect(parseSchedule("every 15m")).toMatchObject({
      kind: "interval",
      minutes: 15,
    });
    expect(parseSchedule("every 2h")).toMatchObject({
      kind: "interval",
      minutes: 120,
    });
  });

  it("treats rich combined intervals as invalid", () => {
    const r = parseSchedule("every 1h 30m");
    expect(r.kind).toBe("invalid");
  });

  it("accepts every-Nd as valid day interval", () => {
    expect(parseSchedule("every 2d")).toMatchObject({
      kind: "interval",
      minutes: 2880,
    });
  });

  it("treats every-Nw as invalid", () => {
    expect(parseSchedule("every 1w").kind).toBe("invalid");
  });
});
