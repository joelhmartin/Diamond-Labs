import { test } from "vitest";
import assert from "node:assert/strict";
import { planMerge, normalizePatient } from "./merge-rules.js";
import { LabOrderError } from "./lab-order-rules.js";

const now = new Date("2026-11-05T15:00:00Z");
const order = (id, n, extra = {}) => ({
  id, orderNumber: n, source: "staff", sourceId: id, clientUserId: "doc1", status: "received", heldFrom: null,
  shipmentId: null, dueDate: null, rush: false, rushTier: null, isRemake: false, version: 3, ...extra,
});
const line = (id, labOrderId, position) => ({ id, labOrderId, position, variantId: `v-${id}`, code: "C", name: `Line ${id}`, qty: 1, noteOnly: false });

function input({ primary = order("p", 100), others = [order("a", 101)], patients, invoices = new Map(), linesByOrder } = {}) {
  const all = [primary, ...others];
  return {
    primary, others,
    patients: patients ?? new Map(all.map((o) => [o.id, "Jane Roe"])),
    invoices,
    linesByOrder: linesByOrder ?? new Map(all.map((o) => [o.id, []])),
    now, byUserId: "staff1",
  };
}

const refuses = (fn, pattern) => assert.throws(fn, (e) => e instanceof LabOrderError && e.code === "INVALID" && pattern.test(e.message));

test("patients equal after normalising merge", () => {
  assert.equal(normalizePatient("  Jane   ROE "), "jane roe");
  const patients = new Map([["p", "Jane Roe"], ["a", "  jane  roe"]]);
  const plan = planMerge(input({ patients }));
  assert.equal(plan.otherPatches.length, 1);
});

test("different patients refuse, without naming either", () => {
  const patients = new Map([["p", "Jane Roe"], ["a", "John Roe"]]);
  assert.throws(() => planMerge(input({ patients })), (e) => {
    assert.equal(e.code, "INVALID");
    assert.doesNotMatch(e.message, /Jane|John|Roe/i);
    return true;
  });
});

test("a missing patient refuses", () => {
  refuses(() => planMerge(input({ patients: new Map([["p", "Jane Roe"], ["a", null]]) })), /patient/);
});

test("different practices refuse", () => {
  refuses(() => planMerge(input({ others: [order("a", 101, { clientUserId: "doc2" })] })), /practice/);
});

test("an order with a shipping label refuses", () => {
  refuses(() => planMerge(input({ others: [order("a", 101, { status: "ready_to_ship", shipmentId: "s1" })] })), /#101 has a shipping label/);
});

test("shop, legacy and terminal orders refuse", () => {
  refuses(() => planMerge(input({ others: [order("a", 101, { source: "shop_order" })] })), /#101/);
  refuses(() => planMerge(input({ others: [order("a", 101, { source: "legacy" })] })), /#101/);
  refuses(() => planMerge(input({ others: [order("a", 101, { status: "shipped" })] })), /#101 is shipped/);
  refuses(() => planMerge(input({ primary: order("p", 100, { status: "cancelled" }) })), /#100 is cancelled/);
});

test("an invoice that is not a draft refuses", () => {
  const invoices = new Map([["a", { status: "issued" }]]);
  refuses(() => planMerge(input({ invoices })), /#101.*invoice/);
  // A draft (or no invoice yet) is fine.
  assert.ok(planMerge(input({ invoices: new Map([["a", { status: "draft" }]]) })));
});

test("a remake and a non-remake refuse (their lines are priced differently)", () => {
  refuses(() => planMerge(input({ others: [order("a", 101, { isRemake: true })] })), /remake/i);
});

test("six orders refuse, and one order refuses", () => {
  const others = ["a", "b", "c", "d", "e"].map((id, i) => order(id, 101 + i));
  refuses(() => planMerge(input({ others })), /2 to 5/);
  refuses(() => planMerge(input({ others: [] })), /2 to 5/);
});

test("a primary that is also among the others refuses", () => {
  refuses(() => planMerge(input({ others: [order("p", 100)] })), /primary/i);
});

test("due becomes the earliest non-null and rush ORs", () => {
  const primary = order("p", 100, { dueDate: "2026-11-20" });
  const others = [order("a", 101, { dueDate: null }), order("b", 102, { dueDate: "2026-11-12", rush: true, rushTier: "3 day" })];
  const { primaryPatch, events } = planMerge(input({ primary, others }));
  assert.equal(primaryPatch.dueDate, "2026-11-12");
  assert.equal(primaryPatch.rush, true);
  assert.equal(primaryPatch.rushTier, "3 day");
  assert.equal(primaryPatch.version, 4);
  const due = events.find((e) => e.type === "due");
  assert.deepEqual([due.labOrderId, due.from, due.to], ["p", "2026-11-20", "2026-11-12"]);
});

test("the primary keeps its own rush tier and its due when it is already earliest", () => {
  const primary = order("p", 100, { dueDate: "2026-11-10", rush: true, rushTier: "Next day" });
  const others = [order("a", 101, { dueDate: "2026-11-12", rush: true, rushTier: "3 day" })];
  const { primaryPatch, events } = planMerge(input({ primary, others }));
  assert.deepEqual([primaryPatch.dueDate, primaryPatch.rush, primaryPatch.rushTier], ["2026-11-10", true, "Next day"]);
  assert.equal(events.some((e) => e.type === "due"), false);
});

test("others are cancelled with Merged into #P and point at the primary", () => {
  const others = [order("a", 101), order("b", 102, { status: "on_hold", heldFrom: "in_production" })];
  const { otherPatches, events } = planMerge(input({ others }));
  assert.deepEqual(otherPatches.map((o) => [o.id, o.expectedVersion, o.patch.status, o.patch.mergedIntoOrderId, o.patch.version]), [
    ["a", 3, "cancelled", "p", 4],
    ["b", 3, "cancelled", "p", 4],
  ]);
  assert.ok(otherPatches.every((o) => o.patch.cancelledAt === now));
  const cancels = events.filter((e) => e.type === "status");
  assert.deepEqual(cancels.map((e) => [e.labOrderId, e.to, e.note]), [["a", "cancelled", "Merged into #100"], ["b", "cancelled", "Merged into #100"]]);
  const note = events.find((e) => e.labOrderId === "p" && e.type === "merge");
  assert.equal(note.note, "Merged #101, #102 into this order");
});

test("appended lines continue the primary's positions", () => {
  const others = [order("a", 101), order("b", 102)];
  const linesByOrder = new Map([
    ["p", [line("p0", "p", 0), line("p3", "p", 3)]],
    ["a", [line("a1", "a", 1), line("a0", "a", 0)]],
    ["b", [line("b0", "b", 0)]],
  ]);
  const { appendLines } = planMerge(input({ others, linesByOrder }));
  assert.deepEqual(appendLines.map((l) => [l.id, l.labOrderId, l.position]), [["a0", "p", 4], ["a1", "p", 5], ["b0", "p", 6]]);
  assert.equal(appendLines[0].variantId, "v-a0", "the line moves whole (its id, variant and materials stay with it)");
});
