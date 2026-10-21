import { test } from "vitest";
import assert from "node:assert/strict";
import { isoDateIn, LAB_TIMEZONE, LEGACY_SETTLEMENT_SOURCE } from "@my-app/shared";
import { planInvoiceSettlements, planClientOpenings, mapOpeningInvoice, OPENING_LINE_DESCRIPTION } from "./balance-plan.js";

const inv = (n, total, extra = {}) => ({
  id: `id-${n}`, invoiceNumber: n, kind: "legacy", legacySeazonaInvoiceId: `inv-${n}`, clientUserId: "u-1324",
  status: "issued", totalCents: total, issuedAt: new Date("2026-01-30T17:00:00Z"), ...extra,
});
const legacy = [
  inv(11114, 125000),
  inv(11115, 30000),
  inv(11120, 8000, { status: "void", clientUserId: "u-2001" }),
  inv(11121, 9500, { clientUserId: "u-2001" }),
  inv(16300, 50000, { legacySeazonaInvoiceId: "opening:1324" }),
];
const invoiceRows = [{ key: 11114, cents: 125000 }, { key: 11115, cents: 12050 }, { key: 11120, cents: -2000 }, { key: 11999, cents: 500 }];

test("per-invoice: each invoice settles total - open; untouched invoices settle in full", () => {
  const plan = planInvoiceSettlements({ legacyInvoices: legacy, exportRows: invoiceRows, existingTransactionIds: new Set() });
  assert.deepEqual(plan.rows.map((r) => [r.invoiceNumber, r.appliedCents, r.transactionId]), [["11115", 17950, "legacy:inv-11115"], ["11121", 9500, "legacy:inv-11121"]]);
  const r = plan.rows[0];
  assert.equal(r.source, LEGACY_SETTLEMENT_SOURCE);
  assert.equal(r.invoiceId, "id-11115");
  assert.equal(r.userId, null, "a settlement is not a payment anyone made");
  assert.equal(r.paidOn, isoDateIn(LAB_TIMEZONE, new Date("2026-01-30T17:00:00Z")), "dated the day the invoice was issued");
  assert.equal(plan.openByClient.get("u-1324"), 137050);
  assert.deepEqual(plan.unmatched, [11999]);
  assert.deepEqual(plan.openOnVoid, [11120]);
  assert.equal(plan.rows.some((x) => x.invoiceNumber === "16300"), false, "an opening-balance invoice is never settled here");
});

test("per-invoice: an open balance above the total is reported, a credit is reported and nothing goes below zero", () => {
  const plan = planInvoiceSettlements({
    legacyInvoices: [inv(1, 1000), inv(2, 1000)], exportRows: [{ key: 1, cents: 1500 }, { key: 2, cents: -300 }], existingTransactionIds: new Set(),
  });
  assert.deepEqual(plan.overTotal, [1]);
  assert.deepEqual(plan.credits, [{ invoiceNumber: 2, clientUserId: "u-1324", cents: -300 }]);
  assert.deepEqual(plan.rows.map((r) => [r.invoiceNumber, r.appliedCents]), [["2", 1000]]);
});

test("per-invoice: a re-run with the same export writes nothing new", () => {
  const first = planInvoiceSettlements({ legacyInvoices: legacy, exportRows: invoiceRows, existingTransactionIds: new Set() });
  const again = planInvoiceSettlements({ legacyInvoices: legacy, exportRows: invoiceRows, existingTransactionIds: new Set(first.rows.map((r) => r.transactionId)) });
  assert.equal(again.rows.length, 0);
  assert.equal(again.alreadySettled, 2);
});

test("per-invoice: an invoice that already has a real payment is reported and not settled", () => {
  const plan = planInvoiceSettlements({
    legacyInvoices: legacy, exportRows: invoiceRows, existingTransactionIds: new Set(), paidByInvoice: new Map([["id-11115", 5000]]),
  });
  assert.deepEqual(plan.hasPayments, [11115]);
  assert.deepEqual(plan.rows.map((r) => r.invoiceNumber), ["11121"]);
});

const owners = new Map([["1324", "u-1324"], ["2001", "u-2001"]]);

test("per-client: every history invoice settles in full; one opening invoice per owing client", () => {
  const plan = planClientOpenings({
    legacyInvoices: legacy,
    exportRows: [{ key: "1324", cents: 137050 }, { key: "2001", cents: -2000 }, { key: "3005", cents: 0 }, { key: "7777", cents: 900 }],
    ownerByAccount: owners, existingTransactionIds: new Set(), existingOpeningKeys: new Set(),
  });
  assert.deepEqual(plan.settlements.map((r) => [r.invoiceNumber, r.appliedCents, r.transactionId]), [
    ["11114", 125000, "legacy-full:inv-11114"], ["11115", 30000, "legacy-full:inv-11115"], ["11121", 9500, "legacy-full:inv-11121"],
  ]);
  assert.deepEqual(plan.openings, [{ accountNumber: "1324", clientUserId: "u-1324", cents: 137050 }]);
  assert.deepEqual(plan.credits, [{ accountNumber: "2001", clientUserId: "u-2001", cents: -2000 }]);
  assert.deepEqual(plan.unmatched, ["7777"]);
});

test("per-client: an account with no single eligible owner opens unowned, an unknown account writes nothing", () => {
  const plan = planClientOpenings({
    legacyInvoices: [], exportRows: [{ key: "1", cents: 100 }, { key: "2", cents: 200 }, { key: "3", cents: 300 }],
    ownerByAccount: new Map([["1", "u"]]), unownedAccounts: new Map([["2", "account_has_multiple_owners"]]),
    existingTransactionIds: new Set(), existingOpeningKeys: new Set(),
  });
  assert.deepEqual(plan.openings, [
    { accountNumber: "1", clientUserId: "u", cents: 100 },
    { accountNumber: "2", clientUserId: null, cents: 200 },
  ]);
  assert.deepEqual([...plan.unowned], [["2", "account_has_multiple_owners"]]);
  assert.deepEqual(plan.unmatched, ["3"]);
});

test("per-client: a history invoice with a real payment is reported, not settled", () => {
  const plan = planClientOpenings({
    legacyInvoices: legacy, exportRows: [], ownerByAccount: owners, existingTransactionIds: new Set(), existingOpeningKeys: new Set(),
    paidByInvoice: new Map([["id-11114", 100]]),
  });
  assert.deepEqual(plan.hasPayments, [11114]);
  assert.equal(plan.settlements.some((r) => r.invoiceNumber === "11114"), false);
});

test("per-client: an existing opening invoice is not created again", () => {
  const plan = planClientOpenings({
    legacyInvoices: [], exportRows: [{ key: "1324", cents: 100 }], ownerByAccount: new Map([["1324", "u"]]),
    existingTransactionIds: new Set(), existingOpeningKeys: new Set(["opening:1324"]),
  });
  assert.equal(plan.openings.length, 0);
  assert.equal(plan.alreadyOpened, 1);
});

test("the opening invoice is legacy, issued at cutover, due that day, one clear line", () => {
  const cutoverAt = new Date("2026-11-07T02:00:00Z"); // Friday evening in San Antonio
  const { invoice, lines } = mapOpeningInvoice({ opening: { accountNumber: "1324", clientUserId: "u-1324", cents: 137050 }, invoiceNumber: 16211, cutoverAt });
  assert.equal(invoice.kind, "legacy");
  assert.equal(invoice.legacySeazonaInvoiceId, "opening:1324");
  assert.equal(invoice.status, "issued");
  assert.equal(invoice.totalCents, 137050);
  assert.equal(invoice.dueDate, "2026-11-06", "the lab-local cutover day");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].description, OPENING_LINE_DESCRIPTION);
  assert.equal(lines[0].lineCents, 137050);
  assert.equal(mapOpeningInvoice({ opening: { accountNumber: "9", clientUserId: null, cents: 1 }, invoiceNumber: 1, cutoverAt }).invoice.clientUserId, null);
});
