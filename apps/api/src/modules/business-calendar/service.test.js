import { test } from "vitest";
import assert from "node:assert/strict";
import { fakeTx } from "../../test/fake-tx.js";
import { getCalendar, saveCalendar, addHoliday } from "./service.js";
import { isOpen } from "./rules.js";

test("getCalendar falls back to defaults when no row exists", async () => {
  const cal = await getCalendar(fakeTx({ selects: [[], []] }), "main");
  assert.equal(cal.key, "main");
  assert.equal(cal.leadDays, 0);
  assert.deepEqual(cal.closedWeekdays, []);
  assert.equal(cal.capacityBasis, "none");
  assert.equal(cal.holidays.size, 0);
});

test("getCalendar builds holidays and labels from rows", async () => {
  const row = { key: "default", timezone: "America/Chicago", leadDays: 1, closedWeekdays: [0, 6], capacityBasis: "orders", capacityByWeekday: { 1: 40 } };
  const holidays = [{ id: "h1", date: "2026-12-25", label: "Christmas" }];
  const cal = await getCalendar(fakeTx({ selects: [[row], holidays] }));
  assert.equal(isOpen("2026-12-25", cal), false);
  assert.equal(cal.holidayLabels.get("2026-12-25"), "Christmas");
  assert.deepEqual(cal.closedWeekdays, [0, 6]);
});

test("refuses a calendar with no open weekday", async () => {
  const tx = fakeTx();
  await assert.rejects(
    saveCalendar(tx, "default", { timezone: "UTC", leadDays: 0, closedWeekdays: [0, 1, 2, 3, 4, 5, 6], capacityBasis: "none", capacityByWeekday: {} }),
    { code: "INVALID" },
  );
  assert.equal(tx.log.some((e) => e.op === "insert"), false);
});

test("saveCalendar upserts the settings with the editor's id", async () => {
  const tx = fakeTx({ selects: [[{ key: "default", timezone: "UTC", leadDays: 2, closedWeekdays: [0], capacityBasis: "none", capacityByWeekday: {} }], []] });
  const cal = await saveCalendar(tx, "default", { timezone: "UTC", leadDays: 2, closedWeekdays: [0], capacityBasis: "none", capacityByWeekday: {} }, { byUserId: "u1" });
  const insert = tx.log.find((e) => e.op === "insert");
  assert.equal(insert.values.updatedBy, "u1");
  assert.equal(insert.values.key, "default");
  assert.equal(cal.leadDays, 2);
});

test("addHoliday on an existing date throws CONFLICT", async () => {
  const tx = fakeTx({ selects: [[{ id: "h1" }]] });
  await assert.rejects(addHoliday(tx, "default", { date: "2026-12-25", label: "Christmas" }), { code: "CONFLICT" });
  assert.equal(tx.log.some((e) => e.op === "insert"), false);
});

test("addHoliday inserts a new date and returns the row", async () => {
  const tx = fakeTx({ selects: [[]] });
  const row = await addHoliday(tx, "default", { date: "2026-12-25", label: "Christmas" });
  assert.equal(row.date, "2026-12-25");
  assert.ok(row.id);
  assert.equal(tx.log.find((e) => e.op === "insert").values.calendarKey, "default");
});
