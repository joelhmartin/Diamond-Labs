import { beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";

process.env.PHI_ENCRYPTION_KEY ??= "a".repeat(64);
// Scheduling has its own tests (lab-scheduling.test.js); here only the seam is pinned.
const sched = vi.hoisted(() => ({ defaultDueAt: vi.fn(), saveSchedule: vi.fn() }));
vi.mock("./lab-scheduling.js", () => sched);
const SCHEDULED = { dueDate: "2026-11-19", plan: { workflowKey: "10d-printed", dueAt: "2026-11-19", stages: [] } };
beforeEach(() => {
  sched.defaultDueAt.mockReset().mockImplementation(async (_tx, { requestedDueDate }) => (
    requestedDueDate ? { ...SCHEDULED, dueDate: requestedDueDate } : SCHEDULED));
  sched.saveSchedule.mockReset().mockResolvedValue(undefined);
});
const { createStaffOrder, previewPrices } = await import("./staff-orders.service.js");
const { LabOrderError } = await import("./lab-order-rules.js");
const { decryptField } = await import("../../lib/crypto.js");
const { fakeTx, fakeDb } = await import("../../test/fake-tx.js");

const inserts = (tx) => tx.log.filter((l) => l.op === "insert").map((l) => l.values);
const quick = { clientUserId: "doc1", patientName: "Jane Roe", lines: [], tagIds: [] };
const doctor = [{ id: "doc1" }];

test("a practice that is not an active doctor is refused before anything is written", async () => {
  const tx = fakeTx({ selects: [[]] });
  await assert.rejects(
    createStaffOrder({ input: quick, byUserId: "staff1" }, fakeDb(tx)),
    (e) => e instanceof LabOrderError && e.code === "INVALID" && e.message === "Pick a practice.",
  );
  assert.equal(tx.log.filter((l) => l.op === "insert" || l.op === "execute").length, 0);
});

test("quick entry: one transaction writes the order (patient sealed), its event and a draft invoice; missing due uses the scheduling default", async () => {
  const tx = fakeTx({ selects: [doctor, [{ max: 100049 }], [{ max: 500010 }]] });
  const out = await createStaffOrder({ input: quick, byUserId: "staff1" }, fakeDb(tx));
  assert.equal(out.labOrder.orderNumber, 100050);
  assert.equal(out.invoice.invoiceNumber, 500011);
  assert.equal(out.panWarning, null);
  const [order, [event], invoice] = inserts(tx);
  assert.deepEqual([order.source, order.sourceId, order.clientUserId], ["staff", out.labOrder.id, "doc1"]);
  assert.notEqual(order.patientName, "Jane Roe", "patient name sealed at rest");
  assert.equal(decryptField(order.patientName), "Jane Roe");
  assert.equal(order.dueDate, "2026-11-19");
  const [, args] = sched.defaultDueAt.mock.calls[0];
  assert.deepEqual([args.variantIds, args.requestedDueDate, args.rush], [[], undefined, false]);
  assert.deepEqual(sched.saveSchedule.mock.calls[0].slice(1), [out.labOrder.id, SCHEDULED.plan]);
  assert.equal(event.type, "release");
  assert.deepEqual([invoice.status, invoice.labOrderId, invoice.totalCents], ["draft", out.labOrder.id, 0]);
});

test("scheduling with nothing to compute enters the order without a due date", async () => {
  sched.defaultDueAt.mockResolvedValueOnce({ dueDate: null, plan: null });
  const tx = fakeTx({ selects: [doctor, [{ max: 100049 }], [{ max: 500010 }]] });
  await createStaffOrder({ input: quick, byUserId: "staff1" }, fakeDb(tx));
  assert.equal(inserts(tx)[0].dueDate, null);
});

test("a requested due date is kept", async () => {
  const tx = fakeTx({ selects: [doctor, [{ max: 100049 }], [{ max: 500010 }]] });
  await createStaffOrder({ input: { ...quick, dueDate: "2026-12-24" }, byUserId: "staff1" }, fakeDb(tx));
  assert.equal(inserts(tx)[0].dueDate, "2026-12-24");
});

test("a pan held by another open order comes back as a warning, never a refusal", async () => {
  const tx = fakeTx({ selects: [doctor, [{ max: 100049 }], [{ max: 500010 }], [{ orderNumber: 100012 }]] });
  const out = await createStaffOrder({ input: { ...quick, pan: "A12" }, byUserId: "staff1" }, fakeDb(tx));
  assert.deepEqual(out.panWarning, { orderNumber: 100012 });
  assert.equal(inserts(tx)[0].panNumber, "A12");
});

test("tags are applied to the new order in the same transaction", async () => {
  const tag = { id: "t1", recordType: "lab_order", label: "Rush", color: "red", position: 0, active: true };
  const tx = fakeTx({ selects: [doctor, [{ max: 100049 }], [{ max: 500010 }], [tag], []] });
  const out = await createStaffOrder({ input: { ...quick, tagIds: ["t1"] }, byUserId: "staff1" }, fakeDb(tx));
  const applied = inserts(tx).find((v) => Array.isArray(v) && v[0]?.tagId === "t1");
  assert.deepEqual([applied[0].recordType, applied[0].recordId, applied[0].createdBy], ["lab_order", out.labOrder.id, "staff1"]);
});

test("an intake id is promoted onto the new order in the same transaction", async () => {
  const tx = fakeTx({ selects: [doctor, [{ max: 100049 }], [{ max: 500010 }]], updates: [[{ id: "in1" }], []] });
  const out = await createStaffOrder({ input: { ...quick, intakeId: "in1" }, byUserId: "staff1" }, fakeDb(tx));
  const sets = tx.log.filter((e) => e.op === "set").map((e) => e.values);
  const claim = sets.find((v) => v.status === "promoted");
  assert.deepEqual([claim.promotedRecordType, claim.promotedRecordId, claim.decidedBy], ["lab_order", out.labOrder.id, "staff1"]);
});

test("an intake that is already used refuses the whole create", async () => {
  const tx = fakeTx({ selects: [doctor, [{ max: 100049 }], [{ max: 500010 }], [{ status: "promoted" }]], updates: [[]] });
  await assert.rejects(
    createStaffOrder({ input: { ...quick, intakeId: "in1" }, byUserId: "staff1" }, fakeDb(tx)),
    (e) => e instanceof LabOrderError && /Already used/.test(e.message),
  );
});

test("lines come from the catalog and are priced for the client", async () => {
  const v1 = { id: "v1", code: "2608", name: "DDSO Nylon", basePriceCents: 45000, taxable: false };
  const tx = fakeTx({ selects: [doctor, [v1], [{ max: 100049 }], [v1], [{ variantId: "v1", priceCents: 40500 }], [], [{ max: 500010 }]] });
  await createStaffOrder({ input: { ...quick, lines: [{ variantId: "v1", qty: 2, name: "nope" }] }, byUserId: "staff1" }, fakeDb(tx));
  assert.deepEqual(sched.defaultDueAt.mock.calls[0][1].variantIds, ["v1"], "the workflow is picked from the ordered variants");
  const [, benchLines, , invoice, invoiceLines] = inserts(tx);
  assert.deepEqual(benchLines.map((l) => [l.name, l.code, l.qty]), [["DDSO Nylon", "2608", 2]]);
  assert.equal(invoice.totalCents, 81000);
  assert.equal(invoiceLines[0].labOrderLineId, benchLines[0].id);
});

test("price preview prices catalog lines for the client without writing", async () => {
  const v1 = { id: "v1", code: "2608", name: "DDSO Nylon", basePriceCents: 45000, taxable: false };
  const tx = fakeTx({ selects: [[v1], [v1], [{ variantId: "v1", priceCents: 40500 }], []] });
  const out = await previewPrices({ clientUserId: "doc1", lines: [{ variantId: "v1", qty: 1 }] }, tx);
  assert.deepEqual(out.map((l) => [l.description, l.unitCents, l.priceSource]), [["DDSO Nylon", 40500, "client"]]);
  assert.equal(tx.log.filter((l) => l.op === "insert" || l.op === "update").length, 0);
});
