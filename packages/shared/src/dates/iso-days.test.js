import { test } from "vitest";
import assert from "node:assert/strict";
import { addIsoDays, daysBetween, isCalendarDate } from "./iso-days.js";
import * as shared from "../index.js";

test("addIsoDays crosses months, years and leap days, and refuses junk", () => {
  assert.equal(addIsoDays("2026-10-15", 30), "2026-11-14");
  assert.equal(addIsoDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addIsoDays("2026-01-01", -1), "2025-12-31");
  assert.equal(addIsoDays("2026-11-06", 14), "2026-11-20");
  assert.equal(addIsoDays("2026-03-07", 1), "2026-03-08", "no DST drift");
  assert.equal(addIsoDays("2026-02-30", 0), "2026-03-02", "an impossible day rolls over");
  assert.throws(() => addIsoDays("10/15/2026", 1), RangeError);
  assert.throws(() => addIsoDays(null, 1), RangeError);
});

test("daysBetween counts whole days either way and refuses junk", () => {
  assert.equal(daysBetween("2026-11-06", "2026-11-20"), 14);
  assert.equal(daysBetween("2026-11-20", "2026-11-06"), -14);
  assert.equal(daysBetween("2026-03-01", "2026-03-31"), 30, "across the DST change");
  assert.equal(daysBetween("2027-12-31", "2028-03-01"), 61);
  assert.throws(() => daysBetween("2026-11-06", "nope"), RangeError);
});

test("isCalendarDate accepts real days only", () => {
  for (const ok of ["2026-11-05", "2028-02-29", "2026-12-31"]) assert.equal(isCalendarDate(ok), true, ok);
  for (const bad of ["2026-13-01", "2026-02-30", "2027-02-29", "2026-00-10", "2026-1-5", "", null, 20261105]) {
    assert.equal(isCalendarDate(bad), false, String(bad));
  }
});

test("the package root exports them", () => {
  assert.equal(shared.addIsoDays, addIsoDays);
  assert.equal(shared.daysBetween, daysBetween);
  assert.equal(shared.isCalendarDate, isCalendarDate);
});
