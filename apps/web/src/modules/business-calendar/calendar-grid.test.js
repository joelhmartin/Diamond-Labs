import { test } from "vitest";
import assert from "node:assert/strict";
import { monthCells, weekCells, shiftAnchor, rangeFor } from "./calendar-grid.js";

test("monthCells starts on the Sunday on/before the 1st and has 42 days", () => {
  const cells = monthCells("2026-11-18"); // 1 Nov 2026 is a Sunday
  assert.equal(cells.length, 42);
  assert.equal(cells[0], "2026-11-01");
  assert.equal(cells[41], "2026-12-12");
  const mid = monthCells("2026-10-15"); // 1 Oct 2026 is a Thursday
  assert.equal(mid[0], "2026-09-27");
  assert.equal(new Date(`${mid[0]}T00:00:00Z`).getUTCDay(), 0);
});

test("weekCells is the Sunday-first week holding the anchor", () => {
  assert.deepEqual(weekCells("2026-11-05"), ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
});

test("shiftAnchor moves by a month or a week, and rangeFor spans the visible cells", () => {
  assert.equal(shiftAnchor("2026-01-31", "month", 1), "2026-02-01");
  assert.equal(shiftAnchor("2026-11-05", "week", -1), "2026-10-29");
  assert.deepEqual(rangeFor("2026-11-05", "week"), { from: "2026-11-01", to: "2026-11-07" });
  assert.deepEqual(rangeFor("2026-11-05", "month"), { from: "2026-11-01", to: "2026-12-12" });
});
