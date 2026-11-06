import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.PHI_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const { fakeTx } = await import("../../test/fake-tx.js");
const ledger = await import("./ledger.service.js");
const source = readFileSync(fileURLToPath(new URL("./ledger.service.js", import.meta.url)), "utf8");

test("ledgerRowDayBetween: paid_on in range, or no paid_on and created in the lab-day range (no coalesce)", async () => {
  const { renderSql } = await import("../../test/sql-text.js");
  const both = renderSql(ledger.ledgerRowDayBetween({ from: "2026-10-01", to: "2026-10-31" }));
  assert.equal(
    both.text,
    "((invoice_payments.paid_on >= $1::date and invoice_payments.paid_on <= $2::date) or (invoice_payments.paid_on is null and "
      + "invoice_payments.created_at >= ($3::date)::timestamp at time zone 'America/Chicago' and "
      + "invoice_payments.created_at < (($4::date + 1)::timestamp at time zone 'America/Chicago')))",
  );
  assert.deepEqual(both.params, ["2026-10-01", "2026-10-31", "2026-10-01", "2026-10-31"]);
  const from = renderSql(ledger.ledgerRowDayBetween({ from: "2026-10-01" }));
  assert.match(from.text, /^\(\(invoice_payments\.paid_on >= \$1::date\) or \(invoice_payments\.paid_on is null and invoice_payments\.created_at >= /);
  assert.equal(ledger.ledgerRowDayBetween({}), undefined);
  // ledgerRowDay stays the SELECT / GROUP BY expression.
  assert.match(renderSql(ledger.ledgerRowDay).text, /^coalesce\(invoice_payments\.paid_on, /);
});

test("paid per invoice is the SUM of its rows; numbers come back from bigint strings", async () => {
  const db = fakeTx({ selects: [[{ invoiceId: "a", paid: "5500" }, { invoiceId: "b", paid: "-100" }]] });
  const paid = await ledger.paidCentsByInvoice(["a", "b", "a"], db);
  assert.equal(paid.get("a"), 5500);
  assert.equal(paid.get("b"), -100);
  assert.equal((await ledger.paidCentsByInvoice([], fakeTx())).size, 0, "no ids, no query");
});

test("withBalances attaches the one balance rule", async () => {
  const db = fakeTx({ selects: [[{ invoiceId: "a", paid: "2500" }]] });
  const [a, b] = await ledger.withBalances([
    { id: "a", status: "issued", totalCents: 10000 },
    { id: "b", status: "void", totalCents: 5000 },
  ], db);
  assert.deepEqual([a.paidCents, a.balanceCents, a.paid], [2500, 7500, false]);
  assert.deepEqual([b.paidCents, b.balanceCents], [0, 0]);
});

test("a practice's open invoices: issued, still owing, oldest due first, with the lab-local issue date and the account", async () => {
  const db = fakeTx({ selects: [
    [
      { id: "late", clientUserId: "doc1", accountId: "a1", invoiceNumber: 500002, status: "issued", totalCents: 5000, dueDate: "2026-11-30", issuedAt: new Date("2026-10-31T04:30:00Z") },
      { id: "early", clientUserId: "doc2", accountId: "a2", invoiceNumber: 500001, status: "issued", totalCents: 8000, dueDate: "2026-10-30", issuedAt: new Date("2026-09-30T15:00:00Z") },
      { id: "paid", clientUserId: "doc1", accountId: "a1", invoiceNumber: 500003, status: "issued", totalCents: 1000, dueDate: "2026-10-01", issuedAt: new Date("2026-09-01T15:00:00Z") },
    ],
    [{ invoiceId: "paid", paid: "1000" }, { invoiceId: "early", paid: "3000" }],
  ] });
  const open = await ledger.openInvoicesForAccounts(["a1", "a2"], db);
  assert.deepEqual(open.map((i) => [i.id, i.balanceCents, i.accountId]), [["early", 5000, "a2"], ["late", 5000, "a1"]]);
  assert.equal(open[1].issuedOn, "2026-10-30", "04:30 UTC on Oct 31 is still Oct 30 in Chicago");
  assert.deepEqual(Object.keys(open[0]).sort(), ["accountId", "balanceCents", "clientUserId", "dueDate", "id", "invoiceNumber", "issuedOn", "ownerName"]);
});

test("openInvoicesForAccounts: no accounts, no query and nothing open; a row outside the accounts never comes back", async () => {
  const none = fakeTx();
  assert.deepEqual(await ledger.openInvoicesForAccounts([], none), []);
  assert.equal(none.log.length, 0);
  const issuedAt = new Date("2026-10-01T15:00:00Z");
  const db = fakeTx({ selects: [[
    { id: "mine", clientUserId: "doc1", accountId: "a1", invoiceNumber: 500001, status: "issued", totalCents: 1000, dueDate: "2026-10-31", issuedAt },
    { id: "stray", clientUserId: "x", accountId: "a9", invoiceNumber: 500002, status: "issued", totalCents: 1000, dueDate: "2026-10-31", issuedAt },
    { id: "unstamped", clientUserId: "doc1", accountId: null, invoiceNumber: 500003, status: "issued", totalCents: 1000, dueDate: "2026-10-31", issuedAt },
  ], []] });
  assert.deepEqual((await ledger.openInvoicesForAccounts(["a1"], db)).map((i) => i.id), ["mine"]);
});

test("the practice-by-Seazona-id rules are gone from the ledger", () => {
  assert.equal(ledger.practiceUserIds, undefined);
  assert.equal(ledger.openInvoicesForClient, undefined);
  assert.doesNotMatch(source, /seazonaClientId/);
});

test("payment history for a scope: the requested practices' invoices, plus the login's own payments when unnarrowed", async () => {
  const { renderSql } = await import("../../test/sql-text.js");
  const all = renderSql(ledger.paymentHistoryWhere({ accountIds: ["a1", "a2"], userId: "u1", includeOwn: true }));
  assert.match(all.text, /invoices\.account_id in \(\$1, \$2\)/);
  assert.match(all.text, / or invoice_payments\.user_id = \$3/);
  const one = renderSql(ledger.paymentHistoryWhere({ accountIds: ["a1"], userId: "u1", includeOwn: false }));
  assert.doesNotMatch(one.text, /user_id/);
  const nothing = renderSql(ledger.paymentHistoryWhere({ accountIds: [], userId: "u1", includeOwn: false }));
  assert.match(nothing.text, /false/, "no accounts and not the own payments: matches nothing");
});

test("shop checkouts and Seazona settlements stay out of payment history (and so out of the refund screen)", () => {
  assert.match(source, /notInArray\(invoicePayments\.source, HISTORY_EXCLUDED_SOURCES\)/);
  assert.doesNotMatch(source, /\[SHOP_PAYMENT_SOURCE\]/);
  assert.doesNotMatch(source, /catch \(/, "ledger reads fail closed — no soft-fail fallbacks");
});
