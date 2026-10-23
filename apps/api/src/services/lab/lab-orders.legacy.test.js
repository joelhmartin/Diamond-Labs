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
  assert.equal(chains.length, 4);
  assert.ok(chains[3].includes("orderBy") && chains[3].indexOf("orderBy") < chains[3].indexOf("limit"), "the case lookup is ordered before it is limited");
});
