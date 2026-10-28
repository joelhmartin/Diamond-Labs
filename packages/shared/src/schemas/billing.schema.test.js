import { test } from "vitest";
import assert from "node:assert/strict";
import {
  invoiceEditSchema, invoiceVoidSchema, invoiceCreditSchema, manualPaymentSchema, statementQuerySchema, invoiceListQuerySchema,
} from "./billing.schema.js";

const ok = (schema, v) => schema.safeParse(v).success;

test("edits are one of update / add / remove / notes, always with the version seen", () => {
  assert.ok(ok(invoiceEditSchema, { expectedVersion: 2, edit: { op: "update", lineId: "l1", unitCents: 9000, reason: "discount" } }));
  assert.ok(ok(invoiceEditSchema, { expectedVersion: 2, edit: { op: "add", kind: "shipping", description: "Shipping", qty: 1, unitCents: 1500 } }));
  assert.ok(ok(invoiceEditSchema, { expectedVersion: 2, edit: { op: "remove", lineId: "l1" } }));
  assert.ok(ok(invoiceEditSchema, { expectedVersion: 2, edit: { op: "notes", notes: null } }));
  assert.ok(!ok(invoiceEditSchema, { edit: { op: "remove", lineId: "l1" } }), "expectedVersion is required");
  assert.ok(!ok(invoiceEditSchema, { expectedVersion: 2, edit: { op: "add", kind: "gift", description: "x", qty: 1, unitCents: 1 } }));
  assert.ok(!ok(invoiceEditSchema, { expectedVersion: 2, edit: { op: "add", kind: "fee", description: "x", qty: 1, unitCents: 1.5 } }), "cents are integers");
});

test("void and credit need a reason; a credit is a positive cents amount", () => {
  assert.ok(!ok(invoiceVoidSchema, { expectedVersion: 1, reason: "   " }));
  assert.ok(ok(invoiceVoidSchema, { expectedVersion: 1, reason: "Billed the wrong client" }));
  assert.ok(!ok(invoiceCreditSchema, { amountCents: 0, reason: "x" }));
  assert.ok(ok(invoiceCreditSchema, { amountCents: 2500, reason: "Shade mismatch goodwill" }));
});

test("a manual payment's chosen allocations must add up to the payment", () => {
  const base = { method: "check", reference: "1042", amountCents: 30000, paidOn: "2026-10-14" };
  assert.ok(ok(manualPaymentSchema, base), "oldest-first when no allocations are given");
  assert.ok(ok(manualPaymentSchema, { ...base, allocations: [{ invoiceId: "a", amountCents: 10000 }, { invoiceId: "b", amountCents: 20000 }] }));
  assert.ok(!ok(manualPaymentSchema, { ...base, allocations: [{ invoiceId: "a", amountCents: 10000 }] }));
  assert.ok(!ok(manualPaymentSchema, { ...base, method: "bitcoin" }));
  assert.ok(!ok(manualPaymentSchema, { ...base, paidOn: "10/14/2026" }));
});

test("statements are asked for by month; list filters coerce", () => {
  assert.ok(ok(statementQuerySchema, { month: "2026-10" }));
  assert.ok(!ok(statementQuerySchema, { month: "2026-13" }));
  assert.ok(!ok(statementQuerySchema, {}));
  const q = invoiceListQuerySchema.parse({ needsPrice: "true", number: "500123" });
  assert.equal(q.needsPrice, true);
  assert.equal(q.number, 500123);
});

test("invoice list: limit/offset coerce, limit is 1-200, q is trimmed and non-empty", () => {
  assert.deepEqual(invoiceListQuerySchema.parse({ limit: "25", offset: "50", q: "  smile " }), { needsPrice: false, limit: 25, offset: 50, q: "smile" });
  assert.equal(invoiceListQuerySchema.parse({}).limit, undefined, "no limit means the legacy capped list");
  for (const bad of [{ limit: "201" }, { limit: "0" }, { offset: "-1" }, { q: "   " }, { q: "x".repeat(101) }]) assert.ok(!ok(invoiceListQuerySchema, bad), JSON.stringify(bad));
});
