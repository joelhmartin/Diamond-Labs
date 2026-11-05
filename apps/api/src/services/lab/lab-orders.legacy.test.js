process.env.PHI_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { test, vi } from "vitest";
import assert from "node:assert/strict";
import { fakeTx } from "../../test/fake-tx.js";
import { sealOrder } from "./lab-order-crypto.js";

const holder = vi.hoisted(() => ({ db: null }));
vi.mock("../../config/database.js", () => ({ db: new Proxy({}, { get: (_t, k) => holder.db[k] }) }));

const { getLabOrderDetail } = await import("./lab-orders.service.js");

test("getLabOrderDetail's legacy block returns the sealed patient opened, and the order itself no longer carries it", async () => {
  const order = sealOrder({
    id: "lo1", orderNumber: 1, source: "legacy", sourceId: "ord-9", status: "in_production", dueDate: null, shipmentId: null, remakeOfOrderId: null,
    holdReason: null, labNotes: null, legacyPatient: "Test Patient",
  });
  assert.match(order.legacyPatient, /^enc:v1:/, "fixture really is sealed");
  const tx = fakeTx({ selects: [
    [{ order, departmentName: null, assigneeName: null, clientName: "Dr Test" }],
    [], // record files on the order (filesFor is async: its select is awaited before Promise.all subscribes to the others)
    [], // materials (materialsFor is async too, so it follows filesFor)
    [], // lines
    [], // events
    [{ id: "case1", caseNumber: "RX-1" }], // the linked portal case
  ] });
  // Record the method names called on each select chain so the case lookup's ordering can be pinned.
  const chains = [];
  holder.db = { ...tx, select: (...a) => {
    const calls = [];
    chains.push(calls);
    const wrap = (b) => new Proxy(b, { get: (t, k) => (k === "then" ? t.then : (...args) => { calls.push(k); return wrap(t[k](...args)); }) });
    return wrap(tx.select(...a));
  } };
  const detail = await getLabOrderDetail("lo1");
  assert.equal(detail.legacy.patientName, "Test Patient");
  assert.deepEqual([detail.legacy.seazonaOrderId, detail.legacy.caseId, detail.legacy.caseNumber], ["ord-9", "case1", "RX-1"]);
  assert.equal("legacyPatient" in detail.order, false);
  assert.ok(!JSON.stringify(detail).includes("enc:v1:"));
  assert.equal(chains.length, 10, "order, files, lines, events, materials, case; then the labels, the saved plan, calendar and holidays");
  assert.equal(detail.schedule, null, "a legacy order has no plan");
  assert.deepEqual(detail.scheduleFlags, { behind: false, lateStage: null, atRisk: false }, "flags exist without a plan; no due date, so not at risk");
  assert.ok(chains[5].includes("orderBy") && chains[5].indexOf("orderBy") < chains[5].indexOf("limit"), "the case lookup is ordered before it is limited");
});

test("getLabOrderDetail returns a staff order's patient opened under `staff`, and the order's own files", async () => {
  const order = sealOrder({
    id: "lo2", orderNumber: 2, source: "staff", sourceId: "lo2", status: "received", dueDate: "2026-11-19", shipmentId: null, remakeOfOrderId: null,
    holdReason: null, labNotes: null, legacyPatient: null, patientName: "Jane Roe",
  });
  assert.match(order.patientName, /^enc:v1:/, "fixture really is sealed");
  const file = { id: "f1", recordType: "lab_order", recordId: "lo2", kind: "scan", originalName: "upper.stl", contentType: null, size: 10, createdAt: new Date(), storageUrl: "internal" };
  // filesFor is an async function, so its select is awaited first, before Promise.all subscribes to lines and events.
  const tx = fakeTx({ selects: [[{ order, departmentName: null, assigneeName: null, clientName: "Dr Test" }], [file], [], [], []] });
  holder.db = tx;
  const detail = await getLabOrderDetail("lo2");
  assert.deepEqual(detail.staff, { patientName: "Jane Roe" });
  assert.equal("patientName" in detail.order, false);
  assert.deepEqual(detail.recordFiles.map((f) => [f.id, f.originalName]), [["f1", "upper.stl"]]);
  assert.equal("storageUrl" in detail.recordFiles[0], false, "the storage url never leaves the server");
  assert.ok(!JSON.stringify(detail).includes("enc:v1:"));
});
