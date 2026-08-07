import { describe, it, expect } from "vitest";
import { resolveChargeDay, isDueOn, cycleKeyFor, zonedParts, isRetryDay } from "./autopay-schedule.js";

const TZ = "America/Chicago";

describe("resolveChargeDay", () => {
  it("returns the chosen day when the month is long enough", () => {
    expect(resolveChargeDay(2026, 8, 15)).toBe(15);
  });

  it("clamps the 31st to February 28 in a common year", () => {
    expect(resolveChargeDay(2026, 2, 31)).toBe(28);
  });

  it("clamps the 31st to February 29 in a leap year", () => {
    expect(resolveChargeDay(2028, 2, 31)).toBe(29);
  });

  it("clamps the 31st to 30 in a 30-day month", () => {
    expect(resolveChargeDay(2026, 4, 31)).toBe(30);
  });

  it("leaves the 1st alone", () => {
    expect(resolveChargeDay(2026, 2, 1)).toBe(1);
  });
});

describe("isDueOn", () => {
  it("is due on the matching day in lab time", () => {
    expect(isDueOn(15, new Date("2026-08-15T12:00:00Z"), TZ)).toBe(true);
  });

  it("is not due on a different day", () => {
    expect(isDueOn(15, new Date("2026-08-16T12:00:00Z"), TZ)).toBe(false);
  });

  // 2026-08-15T02:00Z is still 2026-08-14 21:00 in Chicago. "The 15th" must
  // mean the 15th at the lab, not in UTC, or a whole cohort charges a day early.
  it("uses lab time, not UTC, at the day boundary", () => {
    expect(isDueOn(15, new Date("2026-08-15T02:00:00Z"), TZ)).toBe(false);
    expect(isDueOn(14, new Date("2026-08-15T02:00:00Z"), TZ)).toBe(true);
  });

  it("fires on the clamped day for a doctor who chose the 31st", () => {
    expect(isDueOn(31, new Date("2026-02-28T15:00:00Z"), TZ)).toBe(true);
  });

  it("does not fire twice when the month has 31 days", () => {
    expect(isDueOn(31, new Date("2026-03-28T15:00:00Z"), TZ)).toBe(false);
    expect(isDueOn(31, new Date("2026-03-31T15:00:00Z"), TZ)).toBe(true);
  });
});

describe("cycleKeyFor", () => {
  it("returns a year-month key in lab time", () => {
    expect(cycleKeyFor(new Date("2026-08-15T12:00:00Z"), TZ)).toBe("2026-08");
  });

  it("zero-pads single-digit months", () => {
    expect(cycleKeyFor(new Date("2026-03-02T12:00:00Z"), TZ)).toBe("2026-03");
  });

  it("attributes a UTC-rollover instant to the lab's month", () => {
    expect(cycleKeyFor(new Date("2026-09-01T03:00:00Z"), TZ)).toBe("2026-08");
  });
});

describe("zonedParts", () => {
  it("extracts lab-local calendar parts", () => {
    expect(zonedParts(new Date("2026-08-15T02:00:00Z"), TZ)).toEqual({ year: 2026, month: 8, day: 14 });
  });
});

describe("isRetryDay", () => {
  it("matches day+2 for an ordinary mid-month charge day", () => {
    expect(isRetryDay(15, new Date("2026-08-17T15:00:00Z"), TZ)).toEqual({ offset: 2, cycleKey: "2026-08" });
  });

  it("matches day+5 for an ordinary mid-month charge day", () => {
    expect(isRetryDay(15, new Date("2026-08-20T15:00:00Z"), TZ)).toEqual({ offset: 5, cycleKey: "2026-08" });
  });

  it("is null on the charge day itself", () => {
    expect(isRetryDay(15, new Date("2026-08-15T15:00:00Z"), TZ)).toBeNull();
  });

  it("is null on a day that is neither the charge day nor a retry day", () => {
    expect(isRetryDay(15, new Date("2026-08-18T15:00:00Z"), TZ)).toBeNull();
    expect(isRetryDay(15, new Date("2026-08-21T15:00:00Z"), TZ)).toBeNull();
  });

  it("rolls day+2/+5 into the next month for a day-30 preference (April has 30 days), tagged with April's cycle", () => {
    // April has 30 days: charge day is Apr 30, so +2 lands on May 2 and +5 on
    // May 5 — NOT a nonexistent "April 32/35". Both retries belong to
    // APRIL's cycle (the charge they're retrying), not May's.
    expect(isRetryDay(30, new Date("2026-05-02T15:00:00Z"), TZ)).toEqual({ offset: 2, cycleKey: "2026-04" });
    expect(isRetryDay(30, new Date("2026-05-05T15:00:00Z"), TZ)).toEqual({ offset: 5, cycleKey: "2026-04" });
    // And May 2/5 must not ALSO match some other spurious offset from May's
    // own charge day (30) — only the carry-over from April's charge day
    // should fire here.
    expect(isRetryDay(30, new Date("2026-06-02T15:00:00Z"), TZ)).toBeNull();
    expect(isRetryDay(30, new Date("2026-06-05T15:00:00Z"), TZ)).toBeNull();
  });

  it("rolls a clamped Feb-28 charge day (dayOfMonth=31) into March, tagged with February's cycle", () => {
    // 2026 is not a leap year: Feb clamps day 31 -> Feb 28, so +2 -> Mar 2,
    // +5 -> Mar 5. Both belong to FEBRUARY's cycle, not March's.
    expect(isRetryDay(31, new Date("2026-03-02T15:00:00Z"), TZ)).toEqual({ offset: 2, cycleKey: "2026-02" });
    expect(isRetryDay(31, new Date("2026-03-05T15:00:00Z"), TZ)).toEqual({ offset: 5, cycleKey: "2026-02" });
  });

  it("rolls a day-28 preference's Feb 2 retry into January's cycle", () => {
    // dayOfMonth 28 charges on Jan 28; +2 lands on Jan 30 (still January,
    // not a retry-day match against February), +5 lands on Feb 2, tagged
    // with JANUARY's cycle (2026-01), not February's.
    expect(isRetryDay(28, new Date("2026-02-02T15:00:00Z"), TZ)).toEqual({ offset: 5, cycleKey: "2026-01" });
  });

  it("does not double-fire March's own day-31 charge day as a retry of itself", () => {
    // March has 31 days, so dayOfMonth=31 charges ON Mar 31 (not a retry) —
    // the retry days for THAT cycle are Apr 2 / Apr 5, not Mar-something.
    expect(isRetryDay(31, new Date("2026-03-31T15:00:00Z"), TZ)).toBeNull();
    expect(isRetryDay(31, new Date("2026-04-02T15:00:00Z"), TZ)).toEqual({ offset: 2, cycleKey: "2026-03" });
    expect(isRetryDay(31, new Date("2026-04-05T15:00:00Z"), TZ)).toEqual({ offset: 5, cycleKey: "2026-03" });
  });

  it("uses lab time, not UTC, at the day boundary", () => {
    // 2026-08-17T02:00Z is still 2026-08-16 21:00 in Chicago. Against a
    // charge day of 15 the day+2 target is the 17th, which this instant has
    // NOT reached in lab time yet; against a charge day of 14 the target is
    // the 16th, which it has.
    expect(isRetryDay(15, new Date("2026-08-17T02:00:00Z"), TZ)).toBeNull();
    expect(isRetryDay(14, new Date("2026-08-17T02:00:00Z"), TZ)).toEqual({ offset: 2, cycleKey: "2026-08" });
  });

  it("same-month retry (no rollover) is tagged with the current cycle", () => {
    // Sanity check for requirement 3: a same-month charge's retry base
    // cycle equals the current cycle it's already in.
    const match = isRetryDay(15, new Date("2026-08-17T15:00:00Z"), TZ);
    expect(match.cycleKey).toBe(cycleKeyFor(new Date("2026-08-17T15:00:00Z"), TZ));
  });
});
