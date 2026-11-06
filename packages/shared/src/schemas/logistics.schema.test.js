import { test } from "vitest";
import assert from "node:assert/strict";
import {
  pickupRequestSchema, labPickupRequestSchema, pickupScheduleSchema, pickupCompleteSchema,
  pickupCancelSchema, pickupDoctorCancelSchema, pickupListQuerySchema, labPickupListQuerySchema, labDeliveriesQuerySchema,
} from "./logistics.schema.js";

test("the deliveries query takes an optional from/to date and nothing else", () => {
  assert.deepEqual(labDeliveriesQuerySchema.parse({}), {});
  assert.deepEqual(labDeliveriesQuerySchema.parse({ from: "2026-11-05", to: "2026-11-11" }), { from: "2026-11-05", to: "2026-11-11" });
  assert.equal(labDeliveriesQuerySchema.safeParse({ from: "11/05/2026" }).success, false);
  assert.equal(labDeliveriesQuerySchema.safeParse({ from: "2026-11-05", extra: 1 }).success, false);
  for (const bad of ["2026-13-01", "2026-02-30", "2027-02-29", "2026-00-10"]) {
    assert.equal(labDeliveriesQuerySchema.safeParse({ from: bad }).success, false, `from ${bad}`);
    assert.equal(labDeliveriesQuerySchema.safeParse({ to: bad }).success, false, `to ${bad}`);
    assert.equal(labPickupListQuerySchema.safeParse({ from: bad }).success, false, `pickups from ${bad}`);
  }
  assert.equal(labDeliveriesQuerySchema.safeParse({ from: "2028-02-29" }).success, true, "a leap day is real");
});

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

test("a pickup request and the client list may name a practice", () => {
  assert.equal(pickupRequestSchema.parse({ ...req, accountId: "acc1" }).accountId, "acc1");
  assert.equal(labPickupRequestSchema.parse({ ...req, clientUserId: "d1", accountId: "acc1" }).accountId, "acc1");
  assert.equal(pickupRequestSchema.safeParse({ ...req, accountId: "" }).success, false);
  assert.equal(pickupListQuerySchema.parse({ account: "all" }).account, "all");
  assert.equal(pickupListQuerySchema.safeParse({ account: "x".repeat(129) }).success, false);
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
