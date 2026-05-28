/** @jest-environment node */

import { parseRepeatJson } from "@/lib/cron/write";

describe("parseRepeatJson", () => {
  it("preserves null times for infinite repeat", () => {
    const json = parseRepeatJson({ times: null, completed: 0 });
    expect(JSON.parse(json)).toEqual({ times: null, completed: 0 });
  });

  it("defaults undefined repeat to one-shot", () => {
    const json = parseRepeatJson(undefined);
    expect(JSON.parse(json)).toEqual({ times: 1, completed: 0 });
  });

  it("preserves finite repeat counts", () => {
    const json = parseRepeatJson({ times: 5, completed: 2 });
    expect(JSON.parse(json)).toEqual({ times: 5, completed: 2 });
  });
});
