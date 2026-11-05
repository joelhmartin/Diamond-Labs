import { test } from "vitest";
import assert from "node:assert/strict";
import {
  pickupRequestSchema, labPickupRequestSchema, pickupScheduleSchema, pickupCompleteSchema,
  pickupCancelSchema, pickupDoctorCancelSchema, pickupListQuerySchema, labPickupListQuerySchema,
} from "./logistics.schema.js";

const req = { earliestDate: "2026-11-09", latestDate: "2026-11-10", timePreference: "am", boxCount: 2 };

test("a pickup request needs a window, a time preference and 1–20 boxes; notes are at most 500", () => {
  assert.ok(pickupRequestSchema.safeParse(req).success);
  assert.ok(pickupRequestSchema.safeParse({ ...req, latestDate: undefined }).success);
  assert.equal(pickupRequestSchema.safeParse({ ...req, timePreference: undefined }).success, false);
  assert.equal(pickupRequestSchema.safeParse({ ...req, boxCount: 0 }).success, false);
  assert.equal(pickupRequestSchema.safeParse({ ...req, boxCount: 21 }).success, false);
  assert.equal(pickupRequestSchema.safeParse({ ...req, earliestDate: "11/09/2026" }).success, false);
  assert.equal(pickupRequestSchema.safeParse({ ...req, notes: "x".repeat(501) }).success, false);
  assert.ok(pickupRequestSchema.safeParse({ ...req, notes: null }).success);
});

test("staff request on behalf of a client names the client", () => {
  assert.equal(labPickupRequestSchema.safeParse(req).success, false);
  assert.ok(labPickupRequestSchema.safeParse({ ...req, clientUserId: "d1" }).success);
});

test("staff moves carry the version they saw", () => {
  assert.ok(pickupScheduleSchema.safeParse({ scheduledDate: "2026-11-09", expectedVersion: 1 }).success);
  assert.ok(pickupScheduleSchema.safeParse({ scheduledDate: "2026-11-09", assigneeUserId: null, expectedVersion: 1 }).success);
  assert.equal(pickupScheduleSchema.safeParse({ scheduledDate: "2026-11-09" }).success, false);
  assert.equal(pickupCompleteSchema.safeParse({}).success, false);
  assert.ok(pickupCancelSchema.safeParse({ expectedVersion: 2, reason: "Closed" }).success);
  assert.equal(pickupCancelSchema.safeParse({ reason: "Closed" }).success, false);
});

test("a doctor's cancel may have an empty body", () => {
  assert.deepEqual(pickupDoctorCancelSchema.parse(undefined), {});
  assert.ok(pickupDoctorCancelSchema.safeParse({ expectedVersion: 3 }).success);
});

test("list queries are typed filters", () => {
  assert.deepEqual(pickupListQuerySchema.parse({ status: "requested", limit: "25" }), { status: "requested", limit: 25 });
  assert.equal(pickupListQuerySchema.safeParse({ status: "lost" }).success, false);
  const q = labPickupListQuerySchema.parse({ from: "2026-11-01", to: "2026-11-07", q: " 17 ", assigneeUserId: "s1" });
  assert.deepEqual(q, { from: "2026-11-01", to: "2026-11-07", q: "17", assigneeUserId: "s1" });
});
