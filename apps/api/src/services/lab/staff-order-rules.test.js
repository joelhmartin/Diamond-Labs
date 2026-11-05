import { test } from "vitest";
import assert from "node:assert/strict";
import { planStaffOrder, catalogLines } from "./staff-order-rules.js";
import { LabOrderError } from "./lab-order-rules.js";

const now = new Date("2026-11-06T15:00:00Z");
const variantsById = new Map([
  ["v1", { id: "v1", code: "2608", name: "DDSO Nylon" }],
  ["v2", { id: "v2", code: "7001", name: "Bite registration" }],
]);
const base = { clientUserId: "doc1", patientName: "  Jane Roe ", lines: [], tagIds: [] };
const plan = (input = {}, over = {}) =>
  planStaffOrder({ input: { ...base, ...input }, variantsById, orderNumber: 100050, labOrderId: "lo-new", byUserId: "staff1", now, dueDate: "2026-11-19", ...over });
const isInvalid = (e) => e instanceof LabOrderError && e.code === "INVALID";

test("quick entry with no lines makes an order with no lines", () => {
  const out = plan();
  assert.deepEqual(out.lines, []);
  const o = out.labOrder;
  assert.deepEqual([o.id, o.orderNumber, o.source, o.sourceId, o.clientUserId, o.status, o.version], ["lo-new", 100050, "staff", "lo-new", "doc1", "received", 1]);
  assert.equal(o.isRemake, false);
  assert.deepEqual([out.event.type, out.event.to, out.event.byUserId, out.event.labOrderId], ["release", "received", "staff1", "lo-new"]);
});

test("client-supplied line names are ignored", () => {
  const out = plan({ lines: [
    { variantId: "v1", qty: 2, name: "Free stuff", code: "HACK", arch: "upper" },
    { variantId: "v2", qty: 1, noteOnly: true },
  ] });
  assert.deepEqual(out.lines.map((l) => [l.position, l.variantId, l.code, l.name, l.qty, l.arch, l.noteOnly, l.labOrderId]), [
    [0, "v1", "2608", "DDSO Nylon", 2, "upper", false, "lo-new"],
    [1, "v2", "7001", "Bite registration", 1, null, true, "lo-new"],
  ]);
});

test("a note line is noteOnly: true", () => {
  assert.equal(plan({ lines: [{ variantId: "v2", noteOnly: true }] }).lines[0].noteOnly, true);
});

test("an unknown product is refused, and quantities stay in 1–99", () => {
  assert.throws(() => plan({ lines: [{ variantId: "gone", qty: 1 }] }), isInvalid);
  assert.throws(() => plan({ lines: [{ variantId: "v1", qty: 0 }] }), isInvalid);
  assert.throws(() => plan({ lines: [{ variantId: "v1", qty: 100 }] }), isInvalid);
  assert.equal(catalogLines([{ variantId: "v1" }], variantsById)[0].qty, 1, "qty defaults to 1");
});

test("missing due uses the scheduling default (the resolved date is what the plan stores)", () => {
  assert.equal(plan().labOrder.dueDate, "2026-11-19");
  assert.throws(() => plan({}, { dueDate: "2026-02-30" }), isInvalid);
  assert.throws(() => plan({}, { dueDate: null }), isInvalid);
});

test("patientName is required and trimmed", () => {
  assert.equal(plan().labOrder.patientName, "Jane Roe");
  assert.throws(() => plan({ patientName: "   " }), isInvalid);
  assert.throws(() => plan({ patientName: undefined }), isInvalid);
});

test("production fields reuse the field rules: pan trimmed, delivery checked, enclosures canonical JSON", () => {
  const o = plan({
    pan: " A12 ", deliveryMethod: "ups", rush: true, notes: "  call before shipping ",
    enclosures: [{ kind: "model" }, { kind: "impression", note: "upper" }],
  }).labOrder;
  assert.equal(o.panNumber, "A12");
  assert.equal(o.deliveryMethod, "ups");
  assert.equal(o.rush, true);
  assert.equal(o.labNotes, "call before shipping");
  assert.equal(o.enclosures, JSON.stringify([{ kind: "impression", note: "upper" }, { kind: "model" }]));
  assert.throws(() => plan({ deliveryMethod: "pigeon" }), isInvalid);
  assert.throws(() => plan({ pan: "x".repeat(31) }), isInvalid);
  const blank = plan({ pan: "", notes: "", enclosures: [] }).labOrder;
  assert.deepEqual([blank.panNumber, blank.labNotes, blank.enclosures, blank.deliveryMethod, blank.rush], [null, null, null, null, false]);
});

test("the client is required", () => {
  assert.throws(() => plan({ clientUserId: undefined }), (e) => isInvalid(e) && /practice/i.test(e.message));
});
