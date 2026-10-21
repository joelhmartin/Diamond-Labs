process.env.PHI_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { test } from "vitest";
import assert from "node:assert/strict";
import { fakeTx } from "../test/fake-tx.js";

const { readAppSide, readSeazonaSide, readOnly } = await import("./parity-queries.js");

const raw = {
  records: async (entity) => ({
    client: [{ seazonaId: "c1", payload: { id: "c1", accountNumber: "1324" } }, { seazonaId: "c2", payload: { id: "c2", accountNumber: " 2002 " } }],
    invoice: [
      { seazonaId: "i1", payload: { id: "i1", clientId: "c1", invoiceNumber: 1, total: 100, status: "Shipped", due: "2026-01-02" } },
      { seazonaId: "i2", payload: { id: "i2", clientId: "c2", invoiceNumber: 2, total: 50, status: "Shipped", due: "2026-01-03" } },
    ],
    invoice_detail: [],
    order: [{ seazonaId: "o1", payload: { id: "o1", clientId: 7, status: "In Production" } }, { seazonaId: "o2", payload: { id: "o2", status: "Shipped" } }, { seazonaId: "o3", payload: { id: "o3", status: "Mystery" } }],
  })[entity] ?? [],
};

const users = [
  { id: "u1", email: "doc@example.test", seazonaClientId: "c1", seazonaAccountNumber: "1324" },
  { id: "u2", email: "client-c2@seazona-clients.invalid", seazonaClientId: "c2", seazonaAccountNumber: "2002" },
];
const legacy = [
  { id: "L1", invoiceNumber: 1, kind: "legacy", legacySeazonaInvoiceId: "i1", clientUserId: "u1", status: "issued", totalCents: 10000, issuedAt: new Date("2026-01-02T17:00:00Z") },
  { id: "L2", invoiceNumber: 2, kind: "legacy", legacySeazonaInvoiceId: "i2", clientUserId: null, status: "issued", totalCents: 5000, issuedAt: new Date("2025-12-30T17:00:00Z") },
  { id: "L3", invoiceNumber: 3, kind: "legacy", legacySeazonaInvoiceId: "opening:2001", clientUserId: null, status: "issued", totalCents: 700, issuedAt: new Date("2026-02-01T17:00:00Z") },
];
const orders = [
  { sourceId: "o1", status: "in_production", clientUserId: null },
  { sourceId: "o2", status: "shipped", clientUserId: "u1" },
];

test("the app side: balances by account (unowned history keeps its raw-store account), unowned money, and history left without a settlement gross vs paid", async () => {
  // select order: users, legacy invoices, legacy orders, paid sums, settled invoice ids
  const db = fakeTx({ selects: [users, legacy, orders, [{ invoiceId: "L1", paid: "2500" }], []] });
  const app = await readAppSide(readOnly(db), raw);
  assert.deepEqual([...app.balanceByAccount], [["1324", 7500], ["2002", 5000], ["2001", 700]]);
  assert.deepEqual(app.unowned, { count: 2, openCents: 5700, invoiceNumbers: [2, 3] });
  assert.deepEqual(app.historyWithoutSettlement, { count: 2, grossCents: 15000, realPaidCents: 2500, openCents: 12500 });
  assert.deepEqual([...app.accountByInvoiceNumber], [[1, "1324"], [2, "2002"]], "the per-invoice export rolls up through the same account key");
  assert.equal(app.openingInvoices, 1);
  assert.equal(app.placeholders, 1);
  assert.deepEqual(app.invoices.map((i) => [i.number, i.year]), [[1, "2026"], [2, "2025"]], "history only, by lab-local year");
  assert.equal(app.orderCount, 2);
  assert.deepEqual(app.unownedOrders, [{ sourceId: "o1", open: true }]);
  assert.equal(db.log.some((e) => ["insert", "update", "delete"].includes(e.op)), false, "parity never writes the target");
});

test("settled history is not counted as left open, and a settlement is never counted as a real payment", async () => {
  const db = fakeTx({ selects: [users, legacy, orders, [{ invoiceId: "L1", paid: "10000" }], [{ invoiceId: "L1" }]] });
  const app = await readAppSide(db, raw);
  assert.deepEqual(app.historyWithoutSettlement, { count: 1, grossCents: 5000, realPaidCents: 0, openCents: 5000 });
  assert.equal(app.balanceByAccount.get("1324"), 0);
});

test("the Seazona side: ids, statuses and open flags; an unmapped order state is not open", async () => {
  const s = await readSeazonaSide(raw);
  assert.deepEqual(s.clientIds, ["c1", "c2"]);
  assert.deepEqual(s.orders, [
    { id: "o1", clientId: "7", status: "in_production", open: true },
    { id: "o2", clientId: null, status: "shipped", open: false },
    { id: "o3", clientId: null, status: "unknown", open: false },
  ]);
  assert.equal(s.invoices.length, 2);
});

test("readOnly refuses every write path and still reads", async () => {
  const db = readOnly(fakeTx({ selects: [[{ n: 1 }]] }));
  for (const m of ["insert", "update", "delete", "transaction", "execute"]) assert.throws(() => db[m](), /read-only/);
  assert.deepEqual(await db.select().from(), [{ n: 1 }]);
});
