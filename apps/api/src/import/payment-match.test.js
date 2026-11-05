import { test } from "vitest";
import assert from "node:assert/strict";
import { extractInvoiceNumbers, matchPayments, derivedBalances, MATCH_STATUS } from "./payment-match.js";

// Fake invoice numbers only (no real lab data anywhere in these tests).
const known = new Set([12345, 12346, 12347, 12348, 12350, 90001, 7]);
const ex = (t) => extractInvoiceNumbers(t, known);

test("extract: the spellings staff and the portal use", () => {
  assert.deepEqual(ex("Inv 12345"), [12345]);
  assert.deepEqual(ex("#12345"), [12345]);
  assert.deepEqual(ex("12345, 12346"), [12345, 12346]);
  assert.deepEqual(ex("12345 & 12346"), [12345, 12346]);
  assert.deepEqual(ex("Invoices 12345, 12346"), [12345, 12346]);
  assert.deepEqual(ex("Inv#12346/12347"), [12346, 12347]);
  assert.deepEqual(ex("INV12345"), [12345]);
});

test("extract: a remake suffix maps to the known number", () => {
  assert.deepEqual(ex("12345R"), [12345]);
  assert.deepEqual(ex("remake 12346r2"), [12346]);
});

test("extract: small ranges expand only when both ends are known and the span is at most 10", () => {
  assert.deepEqual(ex("12345-12348"), [12345, 12346, 12347, 12348]);
  assert.deepEqual(ex("12345 – 12350"), [12345, 12346, 12347, 12348, 12350], "unknown numbers inside a range are skipped");
  assert.deepEqual(ex("12345-12399"), [12345], "unknown end: no expansion, the known end still counts");
  assert.deepEqual(ex("7-12345"), [7, 12345], "a span over 10 does not expand");
  assert.deepEqual(ex("12348-12345"), [12345, 12348], "a backwards range does not expand");
});

test("extract: unknown numbers, money, dates and phones are ignored; output is distinct and sorted", () => {
  assert.deepEqual(ex("check 4471 for $12,345.00 on 2025-11-29, call 555-0100"), []);
  assert.deepEqual(ex("12346 then 12345 then 12346 again"), [12345, 12346]);
  assert.deepEqual(ex("$12345.00"), [], "an amount is not an invoice number");
  assert.deepEqual(ex(""), []);
  assert.deepEqual(ex(null), []);
  assert.deepEqual(ex("1234567890123"), [], "a long digit run is one number, never split");
});

const inv = (number, totalCents, clientKey = "c1") => ({ number, totalCents, clientKey });
const pay = (id, amountCents, text, clientKey = "c1", date = "2026-01-02") => ({ id, date, amountCents, clientKey, text });
const byNumber = (result) => new Map(result.invoices.map((i) => [i.number, i]));

test("one invoice named: the amount is definite; paid, partial, overpaid", () => {
  const r = matchPayments({
    invoices: [inv(1, 10000), inv(2, 10000), inv(3, 5000), inv(4, 2000)],
    payments: [pay("a", 10000, "Inv 1"), pay("b", 4000, "#2"), pay("c", 6000, "3"), pay("d", 1500, "4"), pay("e", 500, "4")],
  });
  const m = byNumber(r);
  assert.deepEqual(m.get(1), { number: 1, totalCents: 10000, clientKey: "c1", status: MATCH_STATUS.paid, definiteCents: 10000, paymentIds: ["a"] });
  assert.equal(m.get(2).status, MATCH_STATUS.partial);
  assert.equal(m.get(2).definiteCents, 4000);
  assert.equal(m.get(3).status, MATCH_STATUS.paid);
  assert.deepEqual(r.overpaid, [3]);
  assert.equal(m.get(4).status, MATCH_STATUS.paid, "two payments add up");
  assert.deepEqual(m.get(4).paymentIds, ["d", "e"]);
});

test("several invoices named: an exact sum pays each in full, anything else is unclear and nothing is definite", () => {
  const r = matchPayments({
    invoices: [inv(1, 10000), inv(2, 2500), inv(3, 4000), inv(4, 6000)],
    payments: [pay("a", 12500, "Invoices 1, 2"), pay("b", 9000, "3 & 4")],
  });
  const m = byNumber(r);
  assert.equal(m.get(1).status, MATCH_STATUS.paid);
  assert.equal(m.get(2).status, MATCH_STATUS.paid);
  assert.equal(m.get(3).status, MATCH_STATUS.unclear);
  assert.equal(m.get(3).definiteCents, 0);
  assert.deepEqual(m.get(4).paymentIds, ["b"]);
  assert.deepEqual(r.unclearPayments, [{ paymentId: "b", invoiceNumbers: [3, 4] }]);
});

test("definite payment in full wins over an unclear one; definite part plus unclear stays unclear", () => {
  const r = matchPayments({
    invoices: [inv(1, 5000), inv(2, 5000), inv(3, 5000)],
    payments: [pay("a", 5000, "1"), pay("b", 3000, "1, 2"), pay("c", 1000, "3"), pay("d", 7000, "2, 3")],
  });
  const m = byNumber(r);
  assert.equal(m.get(1).status, MATCH_STATUS.paid);
  assert.equal(m.get(2).status, MATCH_STATUS.unclear);
  assert.equal(m.get(3).status, MATCH_STATUS.unclear);
  assert.equal(m.get(3).definiteCents, 1000);
});

test("refunds subtract; unpaid when nothing names the invoice; zero-total invoices are paid", () => {
  const r = matchPayments({
    invoices: [inv(1, 5000), inv(2, 5000), inv(3, 0), inv(4, 3000), inv(5, 2000)],
    payments: [pay("a", 5000, "1"), pay("b", -5000, "refund 1"), pay("c", -5000, "4, 5"), pay("d", 5000, "4,5")],
  });
  const m = byNumber(r);
  assert.equal(m.get(1).status, MATCH_STATUS.unpaid, "paid then refunded");
  assert.equal(m.get(1).definiteCents, 0);
  assert.equal(m.get(2).status, MATCH_STATUS.unpaid);
  assert.deepEqual(m.get(2).paymentIds, []);
  assert.equal(m.get(3).status, MATCH_STATUS.paid);
  assert.equal(m.get(4).status, MATCH_STATUS.unpaid, "an exact multi-invoice refund subtracts each total");
  assert.equal(m.get(4).definiteCents, 0);
});

test("unattributed and cross-client payments are reported and never applied", () => {
  const r = matchPayments({
    invoices: [inv(1, 5000, "c1"), inv(2, 5000, "c2")],
    payments: [pay("a", 5000, "check 99"), pay("b", 5000, "Inv 2", "c1"), pay("c", 10000, "1, 2", "c1"), pay("d", 5000, "2", null)],
  });
  const m = byNumber(r);
  assert.deepEqual(r.unattributedPayments, ["a"]);
  assert.deepEqual(r.crossClient, [{ paymentId: "b", invoiceNumbers: [2] }, { paymentId: "c", invoiceNumbers: [1, 2] }]);
  assert.equal(m.get(1).status, MATCH_STATUS.unpaid);
  assert.equal(m.get(2).status, MATCH_STATUS.paid, "a payment with no client column still applies");
  assert.equal(r.attributedPayments, 1);
});

test("derived balances: paid 0, partial total minus definite, unclear stays open and is reviewed", () => {
  const result = matchPayments({
    invoices: [inv(1, 10000), inv(2, 10000), inv(3, 4000), inv(4, 6000), inv(5, 5000), inv(6, 8000)],
    payments: [pay("a", 12000, "1"), pay("b", 4000, "2"), pay("c", 9000, "3, 4"), pay("d", 1000, "4"), pay("e", -500, "6")],
  });
  const open = derivedBalances(result);
  assert.deepEqual(open.rows, [
    { key: "1", cents: 0 }, { key: "2", cents: 6000 }, { key: "3", cents: 4000 },
    { key: "4", cents: 6000 }, { key: "5", cents: 5000 }, { key: "6", cents: 8000 },
  ]);
  assert.deepEqual(open.review, [3, 4]);
  const review = derivedBalances(result, { unclear: "review" });
  assert.deepEqual(review.rows.find((r) => r.key === "4"), { key: "4", cents: 5000 }, "review mode credits only the definite part");
  assert.deepEqual(review.review, [3, 4]);
  assert.throws(() => derivedBalances(result, { unclear: "paid" }), /open or review/);
});
