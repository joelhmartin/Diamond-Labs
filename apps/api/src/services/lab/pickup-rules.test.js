import { test } from "vitest";
import assert from "node:assert/strict";
import { PickupError, planRequest, planSchedule, planComplete, planCancel, addDays } from "./pickup-rules.js";

const TODAY = "2026-11-05";
const NOW = new Date("2026-11-05T15:00:00Z");
const req = (over = {}) => ({ earliestDate: "2026-11-06", latestDate: "2026-11-07", timePreference: "am", boxCount: 2, notes: "  Back door  ", ...over });
const pickup = (over = {}) => ({
  id: "p1", pickupNumber: 17, status: "requested", earliestDate: "2026-11-06", latestDate: "2026-11-07",
  scheduledDate: null, assigneeUserId: null, version: 3, ...over,
});
const code = (c) => (e) => e instanceof PickupError && e.code === c;

test("a valid request becomes the row values, notes trimmed", () => {
  assert.deepEqual(planRequest(req(), TODAY), {
    earliestDate: "2026-11-06", latestDate: "2026-11-07", timePreference: "am", boxCount: 2, notes: "Back door",
  });
  assert.equal(planRequest(req({ notes: "   " }), TODAY).notes, null);
  // Today counts; no latest date means a one-day window.
  assert.equal(planRequest(req({ earliestDate: TODAY, latestDate: undefined }), TODAY).latestDate, TODAY);
});

test("earliest before today (CT) is refused", () => {
  assert.throws(() => planRequest(req({ earliestDate: "2026-11-04", latestDate: "2026-11-05" }), TODAY), code("INVALID"));
  assert.throws(() => planRequest(req({ earliestDate: "2026-02-30" }), TODAY), code("INVALID"));
});

test("window over 14 days is refused", () => {
  assert.equal(addDays("2026-11-06", 14), "2026-11-20");
  assert.ok(planRequest(req({ latestDate: "2026-11-20" }), TODAY));
  assert.throws(() => planRequest(req({ latestDate: "2026-11-21" }), TODAY), code("INVALID"));
  assert.throws(() => planRequest(req({ latestDate: "2026-11-05" }), TODAY), code("INVALID"));
});

test("box count 0 and 21 refused", () => {
  assert.throws(() => planRequest(req({ boxCount: 0 }), TODAY), code("INVALID"));
  assert.throws(() => planRequest(req({ boxCount: 21 }), TODAY), code("INVALID"));
  assert.throws(() => planRequest(req({ boxCount: 1.5 }), TODAY), code("INVALID"));
  assert.ok(planRequest(req({ boxCount: 20 }), TODAY));
});

test("time preference is required and notes are at most 500 characters", () => {
  assert.throws(() => planRequest(req({ timePreference: undefined }), TODAY), code("INVALID"));
  assert.throws(() => planRequest(req({ notes: "x".repeat(501) }), TODAY), code("INVALID"));
});

test("schedule before earliestDate refused; inside or after the window is fine", () => {
  assert.throws(() => planSchedule(pickup(), { scheduledDate: "2026-11-05", expectedVersion: 3 }, NOW), code("INVALID"));
  const patch = planSchedule(pickup(), { scheduledDate: "2026-11-12", assigneeUserId: "s1", expectedVersion: 3 }, NOW);
  assert.deepEqual(patch, { status: "scheduled", scheduledDate: "2026-11-12", assigneeUserId: "s1", version: 4, updatedAt: NOW });
});

test("reschedule keeps the assignee unless one is sent; null clears it", () => {
  const p = pickup({ status: "scheduled", scheduledDate: "2026-11-06", assigneeUserId: "s1" });
  assert.equal(planSchedule(p, { scheduledDate: "2026-11-07", expectedVersion: 3 }, NOW).assigneeUserId, "s1");
  assert.equal(planSchedule(p, { scheduledDate: "2026-11-07", assigneeUserId: null, expectedVersion: 3 }, NOW).assigneeUserId, null);
});

test("complete only from scheduled", () => {
  assert.throws(() => planComplete(pickup(), { byUserId: "s1", expectedVersion: 3 }, NOW), code("INVALID_TRANSITION"));
  assert.deepEqual(planComplete(pickup({ status: "scheduled" }), { byUserId: "s1", expectedVersion: 3 }, NOW), {
    status: "completed", completedAt: NOW, completedByUserId: "s1", version: 4, updatedAt: NOW,
  });
});

test("staff cancel needs a reason; doctor cancel does not", () => {
  assert.throws(() => planCancel(pickup(), { reason: "  ", byStaff: true, expectedVersion: 3 }, NOW), code("REASON_REQUIRED"));
  assert.deepEqual(planCancel(pickup(), { reason: " Closed ", byStaff: true, expectedVersion: 3 }, NOW), {
    status: "cancelled", cancelledAt: NOW, cancelReason: "Closed", version: 4, updatedAt: NOW,
  });
  assert.equal(planCancel(pickup(), { byStaff: false }, NOW).cancelReason, null);
  assert.throws(() => planCancel(pickup({ status: "completed" }), { byStaff: false }, NOW), code("INVALID_TRANSITION"));
  assert.throws(() => planCancel(pickup(), { reason: "x".repeat(501), byStaff: true, expectedVersion: 3 }, NOW), code("INVALID"));
});

test("stale version → STALE", () => {
  assert.throws(() => planSchedule(pickup(), { scheduledDate: "2026-11-06", expectedVersion: 2 }, NOW), code("STALE"));
  assert.throws(() => planComplete(pickup({ status: "scheduled" }), { byUserId: "s1", expectedVersion: 4 }, NOW), code("STALE"));
  assert.throws(() => planCancel(pickup(), { reason: "x", byStaff: true, expectedVersion: 1 }, NOW), code("STALE"));
  // Staff moves must say which version they saw; a doctor's cancel may leave it out.
  assert.throws(() => planSchedule(pickup(), { scheduledDate: "2026-11-06" }, NOW), code("STALE"));
  assert.throws(() => planCancel(pickup(), { reason: "x", byStaff: true }, NOW), code("STALE"));
});
