import { test } from "vitest";
import assert from "node:assert/strict";
import {
  DEFAULT_CALENDAR, addBusinessDays, subtractBusinessDays, businessDaysBetween, nextOpenDay,
  capacityFor, loadLevel, calendarDays, dateIn, isOpen, toCalendar,
} from "./rules.js";

const cal = { ...DEFAULT_CALENDAR, closedWeekdays: [0, 6], holidays: new Set() };

test("addBusinessDays skips weekends", () => {
  assert.equal(addBusinessDays("2026-11-06", 1, cal), "2026-11-09");
  assert.equal(addBusinessDays("2026-11-02", 13, cal), "2026-11-19");
});

test("skips holidays across the year boundary", () => {
  const c = { ...cal, holidays: new Set(["2026-12-25", "2027-01-01"]) };
  assert.equal(addBusinessDays("2026-12-24", 2, c), "2026-12-29");
  assert.equal(addBusinessDays("2026-12-31", 1, c), "2027-01-04");
});

test("n=0 on a closed day rolls forward", () => {
  assert.equal(addBusinessDays("2026-11-07", 0, cal), "2026-11-09");
});

test("subtractBusinessDays mirrors addBusinessDays", () => {
  assert.equal(subtractBusinessDays("2026-11-09", 1, cal), "2026-11-06");
  assert.equal(subtractBusinessDays("2026-11-08", 0, cal), "2026-11-06");
});

test("businessDaysBetween counts open days in (from, to]", () => {
  assert.equal(businessDaysBetween("2026-11-06", "2026-11-09", cal), 1);
  assert.equal(businessDaysBetween("2026-11-09", "2026-11-06", cal), -1);
  assert.equal(businessDaysBetween("2026-11-06", "2026-11-06", cal), 0);
});

test("all weekdays closed throws", () => {
  assert.throws(() => nextOpenDay("2026-11-02", { ...cal, closedWeekdays: [0, 1, 2, 3, 4, 5, 6] }), { code: "NO_OPEN_DAYS" });
});

test("capacityFor returns null with basis none, 0 when closed, the weekday limit otherwise", () => {
  assert.equal(capacityFor("2026-11-02", cal), null);
  const c = { ...cal, capacityBasis: "orders", capacityByWeekday: { 1: 40, 2: null } };
  assert.equal(capacityFor("2026-11-07", c), 0);
  assert.equal(capacityFor("2026-11-02", c), 40);
  assert.equal(capacityFor("2026-11-03", c), null);
});

test("loadLevel thresholds", () => {
  assert.equal(loadLevel(0, null), "none");
  assert.equal(loadLevel(10, 40), "under");
  assert.equal(loadLevel(34, 40), "near");
  assert.equal(loadLevel(41, 40), "over");
  assert.equal(loadLevel(40, 40), "near");
});

test("calendarDays returns one entry per day with counts and levels", () => {
  const c = {
    ...cal, capacityBasis: "orders", capacityByWeekday: { 1: 10 },
    holidays: new Set(["2026-11-03"]), holidayLabels: new Map([["2026-11-03", "Closure"]]),
  };
  const days = calendarDays(c, "2026-11-01", "2026-11-03", new Map([["2026-11-02", 9]]));
  assert.equal(days.length, 3);
  assert.deepEqual(days[0], { date: "2026-11-01", weekday: 0, open: false, holiday: null, capacity: 0, count: 0, level: "under" });
  assert.deepEqual(days[1], { date: "2026-11-02", weekday: 1, open: true, holiday: null, capacity: 10, count: 9, level: "near" });
  assert.equal(days[2].holiday, "Closure");
  assert.equal(days[2].open, false);
});

test("dateIn converts an instant to the zone's date", () => {
  assert.equal(dateIn("America/Chicago", new Date("2026-11-06T04:30:00Z")), "2026-11-05");
});

test("toCalendar normalises jsonb and builds the holiday set", () => {
  const c = toCalendar({ key: "k", timezone: "UTC", leadDays: 2, closedWeekdays: [0], capacityBasis: "units", capacityByWeekday: { 1: 5 } }, ["2026-12-25"]);
  assert.equal(isOpen("2026-12-25", c), false);
  assert.equal(c.leadDays, 2);
});
