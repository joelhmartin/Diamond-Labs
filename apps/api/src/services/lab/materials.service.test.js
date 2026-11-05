import { test } from "vitest";
import assert from "node:assert/strict";
import { planMaterials } from "./materials.service.js";
import { LabOrderError } from "./lab-order-rules.js";

const isCode = (code) => (e) => e instanceof LabOrderError && e.code === code;
const now = new Date("2026-11-05T15:00:00Z");
const order = (status) => ({ id: "lo-1", orderNumber: 100245, status, version: 4 });
const line = { id: "l1", name: "Nylon" };

test("materials refused on a cancelled order, allowed on shipped", () => {
  const input = [{ material: "Acrylic", lot: "A1" }];
  assert.throws(() => planMaterials(order("cancelled"), line, input, { now }), isCode("INVALID"));
  const plan = planMaterials(order("shipped"), line, input, { byUserId: "u1", now });
  assert.deepEqual(plan.rows, [{ labOrderId: "lo-1", labOrderLineId: "l1", position: 0, material: "Acrylic", lotNumber: "A1", createdBy: "u1" }]);
  assert.equal(plan.event.type, "materials");
  assert.equal(plan.event.labOrderId, "lo-1");
});

test("11 materials refused", () => {
  const many = Array.from({ length: 11 }, (_, i) => ({ material: `M${i}` }));
  assert.throws(() => planMaterials(order("received"), line, many, { now }), isCode("INVALID"));
  assert.equal(planMaterials(order("received"), line, many.slice(0, 10), { now }).rows.length, 10);
});

test("material and lot are trimmed and length-capped; blank materials are dropped", () => {
  const plan = planMaterials(order("received"), line, [{ material: "  Zirconia ", lot: "  " }, { material: " " }], { now });
  assert.deepEqual(plan.rows.map((r) => [r.material, r.lotNumber]), [["Zirconia", null]]);
  assert.throws(() => planMaterials(order("received"), line, [{ material: "x".repeat(121) }], { now }), isCode("INVALID"));
  assert.throws(() => planMaterials(order("received"), line, [{ material: "x", lot: "y".repeat(61) }], { now }), isCode("INVALID"));
});

test("clearing the list is allowed and the event holds names only", () => {
  const plan = planMaterials(order("received"), line, [], { now });
  assert.deepEqual(plan.rows, []);
  assert.match(plan.event.note, /Nylon/);
});
