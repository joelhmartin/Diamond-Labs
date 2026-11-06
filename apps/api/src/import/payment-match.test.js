import { test } from "vitest";
import assert from "node:assert/strict";
import { extractInvoiceNumbers, extractInvoiceMatches, matchPayments, derivedBalances, MATCH_STATUS } from "./payment-match.js";

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
  assert.deepEqual(ex("12,345"), [], "a comma-grouped number is money, never an invoice (it stays open)");
  assert.deepEqual(ex(""), []);
  assert.deepEqual(ex(null), []);
  assert.deepEqual(ex("1234567890123"), [], "a long digit run is one number, never split");
});

test("extract matches: prefixed (inv, invoice, #, the integration's 'Invoices …' list) versus bare", () => {
  const m = (t) => extractInvoiceMatches(t, known).map(({ number, prefixed }) => [number, prefixed]);
  assert.deepEqual(m("Invoices 12345, 12346 & 12347"), [[12345, true], [12346, true], [12347, true]]);
  assert.deepEqual(m("Inv#12346/12347"), [[12346, true], [12347, true]]);
  assert.deepEqual(m("#12345 and 12350"), [[12345, true], [12350, true]]);
  assert.deepEqual(m("visa x12345"), [[12345, false]]);
  assert.deepEqual(m("inv 12345, chk 12346"), [[12345, true], [12346, false]]);
  assert.deepEqual(m("invoice 12345-12347"), [[12345, true], [12346, true], [12347, true]]);
});

const inv = (number, totalCents, clientKey = "c1") => ({ number, totalCents, clientKey });
const pay = (id, amountCents, text, clientKey = "c1", date = "2026-01-02") => ({ id, date, amountCents, clientKey, text });
const byNumber = (result) => new Map(result.invoices.map((i) => [i.number, i]));

test("one invoice named: the amount is definite; paid, partial; an overpayment is unclear (likely a false match)", () => {
  const r = matchPayments({
    invoices: [inv(1, 10000), inv(2, 10000), inv(3, 5000), inv(4, 2000)],
    payments: [pay("a", 10000, "Inv 1"), pay("b", 4000, "#2"), pay("c", 6000, "3"), pay("d", 1500, "4"), pay("e", 500, "4")],
  });
  const m = byNumber(r);
  assert.deepEqual(m.get(1), { number: 1, totalCents: 10000, clientKey: "c1", status: MATCH_STATUS.paid, definiteCents: 10000, paymentIds: ["a"] });
  assert.equal(m.get(2).status, MATCH_STATUS.partial);
  assert.equal(m.get(2).definiteCents, 4000);
  assert.equal(m.get(3).status, MATCH_STATUS.unclear);
  assert.deepEqual(r.overpaid, [3]);
  assert.equal(m.get(4).status, MATCH_STATUS.paid, "two payments add up");
  assert.deepEqual(m.get(4).paymentIds, ["d", "e"]);
  assert.deepEqual([r.prefixedPayments, r.barePayments], [2, 3]);
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
  assert.deepEqual(r.unclearPayments, [{ paymentId: "b", invoiceNumbers: [3, 4], reason: "sum-mismatch" }]);
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

test("refunds subtract and a net refund is flagged; unpaid when nothing names it; zero-total is its own bucket", () => {
  const r = matchPayments({
    invoices: [inv(1, 5000), inv(2, 5000), inv(3, 0), inv(4, 3000), inv(5, 2000), inv(6, 4000)],
    payments: [pay("a", 5000, "1"), pay("b", -5000, "refund 1"), pay("c", -5000, "4, 5"), pay("d", 5000, "4,5"), pay("e", -100, "6")],
  });
  const m = byNumber(r);
  assert.equal(m.get(1).status, MATCH_STATUS.unpaid, "paid then refunded");
  assert.equal(m.get(1).definiteCents, 0);
  assert.equal(m.get(2).status, MATCH_STATUS.unpaid);
  assert.deepEqual(m.get(2).paymentIds, []);
  assert.equal(m.get(3).status, MATCH_STATUS.zeroTotal);
  assert.equal(m.get(4).status, MATCH_STATUS.unpaid, "an exact multi-invoice refund subtracts each total");
  assert.equal(m.get(4).definiteCents, 0);
  assert.deepEqual(r.netRefund, [6], "refunds above payments go to review");
});

test("unattributed (and unattributed refunds) and cross-client payments are reported and never applied", () => {
  const r = matchPayments({
    invoices: [inv(1, 5000, "c1"), inv(2, 5000, "c2")],
    payments: [pay("a", 5000, "check 99"), pay("b", 5000, "Inv 2", "c1"), pay("c", 10000, "1, 2", "c1"), pay("r", -700, "refund chk 12")],
  });
  const m = byNumber(r);
  assert.deepEqual(r.unattributedPayments, ["a", "r"]);
  assert.deepEqual(r.unattributedRefunds, ["r"]);
  assert.deepEqual(r.crossClient, [{ paymentId: "b", invoiceNumbers: [2] }, { paymentId: "c", invoiceNumbers: [1, 2] }]);
  assert.equal(m.get(1).status, MATCH_STATUS.unpaid);
  assert.equal(r.attributedPayments, 0);
});

test("a payment with no resolved client credits nothing definite: its invoices are unclear", () => {
  const r = matchPayments({
    invoices: [inv(1, 5000, "c1"), inv(2, 5000, "c2"), inv(3, 1000, null)],
    payments: [pay("d", 5000, "Inv 2", null), pay("e", 1000, "Inv 3", "c1")],
  });
  const m = byNumber(r);
  assert.equal(m.get(2).status, MATCH_STATUS.unclear);
  assert.equal(m.get(2).definiteCents, 0);
  assert.equal(m.get(3).status, MATCH_STATUS.unclear, "an invoice with no client is not trusted either");
  assert.equal(r.clientUnknownPayments, 2);
  assert.deepEqual(r.unclearPayments.map((u) => u.reason), ["client-unknown", "client-unknown"]);
  assert.equal(r.attributedPayments, 0);
});

test("derived balances: credit-definite by default; open keeps unclear whole; overpaid stays open in both", () => {
  const result = matchPayments({
    invoices: [inv(1, 10000), inv(2, 10000), inv(3, 4000), inv(4, 6000), inv(5, 5000), inv(6, 8000), inv(7, 0)],
    payments: [pay("a", 12000, "1"), pay("b", 4000, "2"), pay("c", 9000, "3, 4"), pay("d", 1000, "4"), pay("e", -500, "6")],
  });
  const def = derivedBalances(result);
  assert.deepEqual(def.rows, [
    { key: "1", cents: 10000 }, { key: "2", cents: 6000 }, { key: "3", cents: 4000 },
    { key: "4", cents: 5000 }, { key: "5", cents: 5000 }, { key: "6", cents: 8000 }, { key: "7", cents: 0 },
  ]);
  assert.deepEqual(def.review, [1, 3, 4]);
  const open = derivedBalances(result, { unclear: "open" });
  assert.deepEqual(open.rows.find((r) => r.key === "4"), { key: "4", cents: 6000 });
  assert.deepEqual(open.rows.find((r) => r.key === "1"), { key: "1", cents: 10000 });
  assert.throws(() => derivedBalances(result, { unclear: "review" }), /credit-definite or open/);
});

// A group is the lab's own label for practices that share a bill (piece 11): a payment from one of them may name a sibling's invoice.
const groups = (pairs) => new Map(pairs);

test("payment naming a sibling invoice in the same group is applied", () => {
  const r = matchPayments({
    invoices: [inv(1, 5000, "c1"), inv(2, 3000, "c2")],
    payments: [pay("a", 3000, "Inv 2", "c1"), pay("b", 8000, "Inv 1, 2", "c1")],
    groupOf: groups([["c1", "north"], ["c2", "north"]]),
  });
  const m = byNumber(r);
  assert.deepEqual(r.sameGroup, ["a", "b"]);
  assert.deepEqual(r.crossClient, []);
  assert.equal(r.attributedPayments, 2);
  assert.equal(m.get(2).definiteCents, 6000, "applied like any attributed payment (here the shared payment adds up too)");
  assert.equal(m.get(1).definiteCents, 5000);
});

test("same payment without groups stays crossClient", () => {
  const input = { invoices: [inv(1, 5000, "c1"), inv(2, 3000, "c2")], payments: [pay("a", 3000, "Inv 2", "c1")] };
  for (const groupOf of [undefined, new Map()]) {
    const r = matchPayments({ ...input, groupOf });
    assert.deepEqual(r.crossClient, [{ paymentId: "a", invoiceNumbers: [2] }]);
    assert.deepEqual(r.sameGroup, []);
    assert.equal(byNumber(r).get(2).definiteCents, 0);
  }
});

test("different groups stay crossClient, and so does a client with no group", () => {
  const r = matchPayments({
    invoices: [inv(1, 5000, "c1"), inv(2, 3000, "c2"), inv(3, 100, "c3")],
    payments: [pay("a", 3000, "Inv 2", "c1"), pay("b", 100, "Inv 3", "c1")],
    groupOf: groups([["c1", "north"], ["c2", "south"]]),
  });
  assert.deepEqual(r.crossClient.map((c) => c.paymentId), ["a", "b"]);
  assert.deepEqual(r.sameGroup, []);
});

test("a payment naming one invoice in the group and one outside it is still crossClient", () => {
  const r = matchPayments({
    invoices: [inv(1, 5000, "c1"), inv(2, 3000, "c2"), inv(3, 100, "c3")],
    payments: [pay("a", 3100, "Inv 2, 3", "c1")],
    groupOf: groups([["c1", "north"], ["c2", "north"], ["c3", "south"]]),
  });
  assert.deepEqual(r.crossClient.map((c) => c.paymentId), ["a"]);
  assert.deepEqual(r.sameGroup, []);
});
