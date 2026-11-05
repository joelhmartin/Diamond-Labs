import { test, vi } from "vitest";
import assert from "node:assert/strict";
import { pickupWindowError } from "@my-app/shared";

vi.mock("../../config/api.js", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const { pickupFormErrors, initialPickupForm } = await import("../pickups.js");

// 2026-11-06 04:00 UTC is still Nov 5 in Chicago.
const now = new Date("2026-11-06T04:00:00Z");
const form = (over = {}) => ({ ...initialPickupForm(now), ...over });

test("the form's window errors are the API's own (shared pickupWindowError), with today in CT", () => {
  assert.deepEqual(pickupFormErrors(form(), { now }), {});
  const cases = [
    [{ earliestDate: "2026-11-04", latestDate: "2026-11-06" }, "earliestDate"],
    [{ earliestDate: "2026-11-08", latestDate: "2026-11-07" }, "latestDate"],
    [{ earliestDate: "2026-11-05", latestDate: "2026-11-20" }, "latestDate"],
  ];
  for (const [over, field] of cases) {
    const expected = pickupWindowError(over.earliestDate, over.latestDate, "2026-11-05");
    assert.equal(expected.field, field);
    assert.deepEqual(pickupFormErrors(form(over), { now }), { [field]: expected.message });
  }
  assert.deepEqual(pickupFormErrors(form({ earliestDate: "2026-11-05", latestDate: "2026-11-19" }), { now }), {}, "14 days is allowed");
});

test("a shape error on a date is reported instead of a window rule", () => {
  const errors = pickupFormErrors(form({ latestDate: "11/07/2026" }), { now });
  assert.ok(errors.latestDate);
  assert.equal(Object.keys(errors).length, 1);
});
