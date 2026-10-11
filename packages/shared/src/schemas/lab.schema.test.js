import { test } from "vitest";
import assert from "node:assert/strict";
import {
  labStatusChangeSchema, labFieldChangeSchema, labRemakeSchema, labOrderListQuerySchema,
  labDepartmentUpdateSchema, rxReleaseSchema, userRoleChangeSchema,
} from "./lab.schema.js";

test("a status change needs a known status and the version the client saw", () => {
  assert.ok(labStatusChangeSchema.safeParse({ to: "in_production", expectedVersion: 3 }).success);
  assert.equal(labStatusChangeSchema.safeParse({ to: "in_production" }).success, false);
  assert.equal(labStatusChangeSchema.safeParse({ to: "done", expectedVersion: 3 }).success, false);
  assert.equal(labStatusChangeSchema.safeParse({ to: "on_hold", reason: "x".repeat(501), expectedVersion: 1 }).success, false);
});

test("field edits are one field at a time, with a typed value", () => {
  assert.ok(labFieldChangeSchema.safeParse({ field: "due", value: "2026-10-21", expectedVersion: 1 }).success);
  assert.ok(labFieldChangeSchema.safeParse({ field: "assign", value: null, expectedVersion: 1 }).success);
  assert.equal(labFieldChangeSchema.safeParse({ field: "due", value: "10/21/2026", expectedVersion: 1 }).success, false);
  assert.equal(labFieldChangeSchema.safeParse({ field: "price", value: "1", expectedVersion: 1 }).success, false);
});

test("a remake needs a reason", () => {
  assert.equal(labRemakeSchema.safeParse({ reason: "", expectedVersion: 1 }).success, false);
  assert.ok(labRemakeSchema.safeParse({ reason: "Cracked", expectedVersion: 1 }).success);
});

test("board query strings become typed filters", () => {
  const q = labOrderListQuerySchema.parse({ rush: "true", includeClosed: "false", dueBefore: "2026-10-10", q: " RX " });
  assert.deepEqual(q, { rush: true, includeClosed: false, dueBefore: "2026-10-10", q: "RX" });
  assert.deepEqual(labOrderListQuerySchema.parse({}), { rush: false, includeClosed: false });
  assert.equal(labOrderListQuerySchema.safeParse({ status: "nope" }).success, false);
});

test("a department update must change something", () => {
  assert.equal(labDepartmentUpdateSchema.safeParse({}).success, false);
  assert.ok(labDepartmentUpdateSchema.safeParse({ active: false }).success);
});

test("release takes an optional Seazona confirmation and tolerates an empty body", () => {
  assert.deepEqual(rxReleaseSchema.parse(undefined), {});
  assert.deepEqual(rxReleaseSchema.parse({ confirmNotInSeazona: true }), { confirmNotInSeazona: true });
});

test("only lab and user can be granted here", () => {
  assert.ok(userRoleChangeSchema.safeParse({ role: "lab" }).success);
  assert.equal(userRoleChangeSchema.safeParse({ role: "admin" }).success, false);
});
