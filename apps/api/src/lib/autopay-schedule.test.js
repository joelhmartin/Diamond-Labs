import { describe, it, expect } from "vitest";
import { resolveChargeDay, isDueOn, cycleKeyFor, zonedParts } from "./autopay-schedule.js";

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
