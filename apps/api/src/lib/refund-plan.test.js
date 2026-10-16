import { test } from "vitest";
import assert from "node:assert/strict";
import { planRefund } from "./refund-plan.js";

const row = (over) => ({
  userId: "doc1", invoiceId: "inv1", seazonaClientId: null, seazonaInvoiceId: null, invoiceNumber: "500001", appliedCents: 6000, ...over,
});

test("a full refund negates every original row and keeps its invoice keys", () => {
  const plan = planRefund([row(), row({ invoiceId: "inv2", invoiceNumber: "500002", appliedCents: 4000 })]);
  assert.equal(plan.totalCents, null, "full: the gateway reverses the whole charge");
  assert.deepEqual(plan.rows.map((r) => [r.invoiceId, r.appliedCents]), [["inv1", -6000], ["inv2", -4000]]);
});

test("a partial refund reverses named slices, each capped at what it was charged", () => {
  const rows = [row(), row({ invoiceId: "inv2", invoiceNumber: "500002", appliedCents: 4000 })];
  const plan = planRefund(rows, [{ invoiceId: "inv2", amountCents: 1500 }]);
  assert.equal(plan.totalCents, 1500);
  assert.deepEqual(plan.rows.map((r) => [r.invoiceId, r.invoiceNumber, r.appliedCents]), [["inv2", "500002", -1500]]);
  assert.match(planRefund(rows, [{ invoiceId: "inv2", amountCents: 4001 }]).error, /exceeds the \$40\.00 charged/);
  assert.match(planRefund(rows, [{ invoiceId: "nope", amountCents: 1 }]).error, /not part of this charge/);
  assert.match(planRefund(rows, [{ invoiceId: "inv1", amountCents: 1 }, { invoiceId: "inv1", amountCents: 1 }]).error, /more than once/);
});

test("a Seazona-era charge (no local invoice id) refunds by its Seazona invoice id", () => {
  const legacy = row({ invoiceId: null, seazonaClientId: "c1", seazonaInvoiceId: "sz-9", invoiceNumber: "41201", appliedCents: 2500 });
  const plan = planRefund([legacy], [{ invoiceId: "sz-9", amountCents: 2500 }]);
  assert.deepEqual(plan.rows[0], {
    invoiceId: null, seazonaClientId: "c1", seazonaInvoiceId: "sz-9", invoiceNumber: "41201", userId: "doc1", appliedCents: -2500,
  });
});
