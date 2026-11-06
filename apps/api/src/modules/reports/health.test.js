import { describe, test, expect } from "vitest";
import { activityHealth } from "./health.js";

const ASOF = new Date("2026-11-05T12:00:00Z");
const ago = (days) => new Date(ASOF.getTime() - days * 86400000);
const T = { inactiveDays: 90, declining: 0.5, stable: 0.85 };
const run = (recent, baseline, days) =>
  activityHealth({ recent, baseline, lastAt: days == null ? null : ago(days), asOf: ASOF }, T);

describe("activityHealth", () => {
  test("activityHealth bands", () => {
    expect(run(0, 4, 120).band).toBe("inactive");
    expect(run(1, 4, 3)).toMatchObject({ band: "declining", trend: 0.25 });
    expect(run(3, 4, 3)).toMatchObject({ band: "stable", trend: 0.75 });
    expect(run(4, 4, 3).band).toBe("healthy");
    expect(run(2, 0, 3)).toMatchObject({ band: "healthy", isNew: true, trend: null });
    expect(run(0, 2, 45).band).toBe("declining");
  });

  test("boundaries: 0.5 is stable, 0.85 is healthy, 90 days is still active", () => {
    expect(run(2, 4, 3).band).toBe("stable");
    expect(run(17, 20, 3).band).toBe("healthy");
    expect(run(0, 2, 90).band).not.toBe("inactive");
    expect(run(0, 2, 91).band).toBe("inactive");
  });

  test("no activity ever, or only old activity with no history, is inactive", () => {
    expect(run(0, 0, null).band).toBe("inactive");
    expect(run(0, 0, 200)).toMatchObject({ band: "inactive", isNew: false });
  });

  test("a missing or invalid asOf throws instead of returning NaN", () => {
    expect(() => activityHealth({ recent: 1, baseline: 1, lastAt: ago(1) }, T)).toThrow(/asOf/);
    expect(() => activityHealth({ recent: 1, baseline: 1, lastAt: ago(1), asOf: "nope" }, T)).toThrow(/asOf/);
  });

  test("accepts ISO strings for dates and does not mark established clients new", () => {
    const r = activityHealth({ recent: 4, baseline: 4, lastAt: ago(1).toISOString(), asOf: ASOF.toISOString() }, T);
    expect(r).toMatchObject({ band: "healthy", isNew: false, trend: 1 });
  });
});
