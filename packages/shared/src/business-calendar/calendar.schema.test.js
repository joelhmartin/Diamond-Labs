import { test } from "vitest";
import assert from "node:assert/strict";
import { calendarDaysQuerySchema, calendarSettingsSchema, holidayCreateSchema } from "./calendar.schema.js";

test("calendarDaysQuerySchema rejects a 63-day span and to < from", () => {
  assert.equal(calendarDaysQuerySchema.safeParse({ from: "2026-11-01", to: "2027-01-03" }).success, false);
  assert.equal(calendarDaysQuerySchema.safeParse({ from: "2026-11-01", to: "2027-01-02" }).success, true);
  assert.equal(calendarDaysQuerySchema.safeParse({ from: "2026-11-05", to: "2026-11-04" }).success, false);
});

test("calendarSettingsSchema validates lead days, weekdays and timezone", () => {
  const ok = { timezone: "America/Chicago", leadDays: 2, closedWeekdays: [0, 6], capacityBasis: "orders", capacityByWeekday: { 1: 40, 2: null } };
  assert.equal(calendarSettingsSchema.safeParse(ok).success, true);
  assert.equal(calendarSettingsSchema.safeParse({ ...ok, leadDays: 91 }).success, false);
  assert.equal(calendarSettingsSchema.safeParse({ ...ok, closedWeekdays: [1, 1] }).success, false);
  assert.equal(calendarSettingsSchema.safeParse({ ...ok, timezone: "Nope/Zone" }).success, false);
  assert.equal(calendarSettingsSchema.safeParse({ ...ok, capacityByWeekday: { 9: 1 } }).success, false);
});

test("holidayCreateSchema needs an ISO date and a label", () => {
  assert.equal(holidayCreateSchema.safeParse({ date: "2026-12-25", label: "Christmas" }).success, true);
  assert.equal(holidayCreateSchema.safeParse({ date: "12/25", label: "x" }).success, false);
});
