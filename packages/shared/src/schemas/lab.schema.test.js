import { test } from "vitest";
import assert from "node:assert/strict";
import { LAB_BOARD_TILES } from "../lab/lab-order-status.js";
import {
  labStatusChangeSchema, labFieldChangeSchema, labRemakeSchema, labOrderListQuerySchema,
  labDepartmentUpdateSchema, rxReleaseSchema, userRoleChangeSchema, labWorkflowChangeSchema, labSchedulePreviewQuerySchema,
} from "./lab.schema.js";

test("a workflow change names a workflow key and the version the client saw", () => {
  assert.deepEqual(labWorkflowChangeSchema.parse({ workflowKey: "7d-1-device", expectedVersion: 2 }), { workflowKey: "7d-1-device", keepDueDate: false, expectedVersion: 2 });
  assert.equal(labWorkflowChangeSchema.safeParse({ workflowKey: "7d-1-device" }).success, false);
  assert.equal(labWorkflowChangeSchema.safeParse({ workflowKey: null, expectedVersion: 2 }).success, false);
  assert.equal(labWorkflowChangeSchema.safeParse({ workflowKey: "Not A Key", expectedVersion: 2 }).success, false);
});

test("the schedule preview reads variant ids as a list or a comma string", () => {
  assert.deepEqual(labSchedulePreviewQuerySchema.parse({}), { variantIds: [], rush: false, workflowKey: null, requestedDueDate: null });
  assert.deepEqual(labSchedulePreviewQuerySchema.parse({ variantIds: "v1, v2,v1", rush: "true" }).variantIds, ["v1", "v2"]);
  assert.deepEqual(labSchedulePreviewQuerySchema.parse({ variantIds: ["v1", "v3"] }).variantIds, ["v1", "v3"]);
  assert.equal(labSchedulePreviewQuerySchema.safeParse({ requestedDueDate: "11/20/2026" }).success, false);
});

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
  assert.deepEqual(q, { rush: true, starred: false, tagIds: [], includeClosed: false, dueBefore: "2026-10-10", q: "RX" });
  assert.deepEqual(labOrderListQuerySchema.parse({}), { rush: false, starred: false, tagIds: [], includeClosed: false });
  assert.equal(labOrderListQuerySchema.safeParse({ status: "nope" }).success, false);
});

test("the board filters by labels (comma list, at most 20) and by the viewer's stars", () => {
  assert.deepEqual(labOrderListQuerySchema.parse({ tagIds: "t1, t2,t1,", starred: "true" }).tagIds, ["t1", "t2"]);
  assert.equal(labOrderListQuerySchema.parse({ starred: "true" }).starred, true);
  const many = Array.from({ length: 21 }, (_, i) => `t${i}`).join(",");
  assert.equal(labOrderListQuerySchema.safeParse({ tagIds: many }).success, false);
  assert.equal(labOrderListQuerySchema.safeParse({ tagIds: many.split(",").slice(0, 20).join(",") }).success, true);
});

test("tile must be one of LAB_BOARD_TILES, and dueOn a real date", () => {
  assert.deepEqual(LAB_BOARD_TILES, ["past_due", "due_today", "due_tomorrow", "on_hold", "at_risk"]);
  for (const tile of LAB_BOARD_TILES) assert.equal(labOrderListQuerySchema.parse({ tile }).tile, tile);
  assert.equal(labOrderListQuerySchema.safeParse({ tile: "overdue" }).success, false);
  assert.equal(labOrderListQuerySchema.parse({ dueOn: "2026-11-12" }).dueOn, "2026-11-12");
  assert.equal(labOrderListQuerySchema.safeParse({ dueOn: "11/12/2026" }).success, false);
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

test("the order list filters by every lab order source, legacy included", () => {
  assert.equal(labOrderListQuerySchema.parse({ source: "legacy" }).source, "legacy");
  assert.equal(labOrderListQuerySchema.safeParse({ source: "seazona" }).success, false);
});

test("lab order list: limit/offset coerce and limit over 200 is rejected", () => {
  const q = labOrderListQuerySchema.parse({ limit: "50", offset: "100" });
  assert.deepEqual([q.limit, q.offset], [50, 100]);
  assert.equal(labOrderListQuerySchema.parse({}).limit, undefined, "the board sends no limit");
  for (const bad of [{ limit: "201" }, { limit: "0" }, { offset: "-5" }]) assert.equal(labOrderListQuerySchema.safeParse(bad).success, false, JSON.stringify(bad));
});
