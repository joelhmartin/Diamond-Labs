/**
 * Per-invoice paid status derived from the lab's Payments export (Billing →
 * Payments → Export). Seazona's API has no paid flag and no payment list, but
 * staff (and the portal's own integration, "Invoices 1234, 1235") put invoice
 * numbers into each payment's reference or notes. Pure functions: the CLI
 * (payments-match-command.js) reads the files and the import DB.
 *
 * The rule (user, verbatim in docs/import-operations.md): an invoice is paid
 * if a payment names it and the amounts add up; partial or unclear if it
 * shares a multi-invoice payment and the total doesn't match; unpaid if no
 * payment names it. Nothing is credited on a guess: a shared payment that does
 * not add up, a payment whose client is unknown, and an overpayment (usually a
 * false number match, "Visa x1234" or a check number) are all unclear.
 */

export const MATCH_STATUS = { paid: "paid", partial: "partial", unclear: "unclear", unpaid: "unpaid", zeroTotal: "zero-total" };
export const UNCLEAR_MODES = ["credit-definite", "open"];

/** The widest range ("12345-12348") that expands into the numbers between its ends. */
export const MAX_RANGE_SPAN = 10;

// Money and decimals are blanked (same length, so indexes hold) so "$12,345.00" or "12,345" never reads as invoice 12345.
const MONEY = /\$\s*[\d,]*\d(?:\.\d+)?|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+\.\d+\b/g;
// A number with an optional remake suffix ("12345R", "12346r2"): the suffix is dropped.
const NUMBER = /(\d+)(?:[A-Za-z]+\d*)?/g;
const RANGE = /(\d+)(?:[A-Za-z]+\d*)?\s*[-–—]\s*(\d+)/g;
// "inv", "invoice(s)", "#" and the list of numbers right after it ("Invoices 1, 2 & 3", "Inv#4/5", "#6 and 7", "invoice 8-10").
const NUM = String.raw`\d+(?:[A-Za-z]+\d*)?`;
const PREFIXED_LIST = new RegExp(String.raw`(?:\binv(?:oice)?s?\b|\binv(?=\d)|#)[\s#:.]*${NUM}(?:\s*(?:,|&|\/|\band\b|[-–—])\s*#?\s*${NUM})*`, "gi");

const asNumber = (digits) => (digits.length <= 9 ? Number(digits) : null);

/**
 * The distinct invoice numbers `text` names that are in `knownNumbers` (a Set
 * of integers), ascending, each with `prefixed`: whether it sits in a list
 * introduced by "inv", "invoice(s)" or "#". Unknown numbers are ignored, which
 * drops check numbers, dates and phone numbers. A range expands only when both
 * ends are known and it spans at most MAX_RANGE_SPAN.
 */
export function extractInvoiceMatches(text, knownNumbers) {
  const clean = String(text ?? "").replace(MONEY, (m) => " ".repeat(m.length));
  const spans = [...clean.matchAll(PREFIXED_LIST)].map((m) => [m.index, m.index + m[0].length]);
  const inSpan = (at) => spans.some(([a, b]) => at >= a && at < b);
  const found = new Map();
  const add = (n, prefixed) => found.set(n, (found.get(n) ?? false) || prefixed);
  for (const m of clean.matchAll(NUMBER)) {
    const n = asNumber(m[1]);
    if (n != null && knownNumbers.has(n)) add(n, inSpan(m.index));
  }
  for (const m of clean.matchAll(RANGE)) {
    const [a, b] = [asNumber(m[1]), asNumber(m[2])];
    if (a == null || b == null || !knownNumbers.has(a) || !knownNumbers.has(b) || b <= a || b - a > MAX_RANGE_SPAN) continue;
    for (let n = a; n <= b; n++) if (knownNumbers.has(n)) add(n, inSpan(m.index));
  }
  return [...found].map(([number, prefixed]) => ({ number, prefixed })).sort((x, y) => x.number - y.number);
}

export const extractInvoiceNumbers = (text, knownNumbers) => extractInvoiceMatches(text, knownNumbers).map((m) => m.number);

/** Per invoice from its accumulated state. An exact definite sum wins over an unclear share; more than the total is unclear. */
function statusOf(s) {
  if (s.totalCents === 0 && s.paymentIds.length === 0) return MATCH_STATUS.zeroTotal;
  if (s.definiteCents > s.totalCents) return MATCH_STATUS.unclear;
  if (s.definiteCents === s.totalCents) return MATCH_STATUS.paid;
  if (s.unclear) return MATCH_STATUS.unclear;
  return s.definiteCents > 0 ? MATCH_STATUS.partial : MATCH_STATUS.unpaid;
}

function markUnclear(payment, named, reason, out) {
  for (const i of named) i.unclear = true;
  out.unclearPayments.push({ paymentId: payment.id, invoiceNumbers: named.map((i) => i.number), reason });
}

/** A payment naming several invoices: definite only when it is exactly their sum (or minus it, for a refund). */
function applyShared(payment, named, out) {
  const sum = named.reduce((n, i) => n + i.totalCents, 0);
  const sign = sum !== 0 && payment.amountCents === sum ? 1 : sum !== 0 && payment.amountCents === -sum ? -1 : 0;
  if (!sign) return markUnclear(payment, named, "sum-mismatch", out);
  for (const i of named) i.definiteCents += sign * i.totalCents;
}

/**
 * invoices: [{ number, totalCents, clientKey }]; payments: [{ id, date,
 * amountCents, clientKey|null, text }] (text = reference + notes).
 * - names no known invoice: unattributed (a negative one is also an unattributed refund);
 * - a named invoice belongs to another known client: cross-client, never applied;
 * - the payment's client (or a named invoice's) is unknown: its invoices are unclear, nothing definite;
 * - otherwise one invoice takes the amount; several take their totals only on an exact sum.
 * A negative amount (refund) subtracts.
 * groupOf (optional Map<clientKey, groupLabel>, the lab's own list of practices
 * that share a bill): when every other client a payment names is in the
 * payer's group, the payment is attributed as normal and listed in `sameGroup`
 * (payment ids) instead of `crossClient`. A client with no label is in no group.
 */
export function matchPayments({ invoices, payments, groupOf = new Map() }) {
  const state = new Map(invoices.map((i) => [i.number, { ...i, definiteCents: 0, unclear: false, paymentIds: [] }]));
  const known = new Set(state.keys());
  const out = {
    attributedPayments: 0, clientUnknownPayments: 0, prefixedPayments: 0, barePayments: 0,
    unattributedPayments: [], unattributedRefunds: [], crossClient: [], sameGroup: [], unclearPayments: [],
  };
  for (const p of payments) {
    const matches = extractInvoiceMatches(p.text, known);
    if (!matches.length) {
      out.unattributedPayments.push(p.id);
      if (p.amountCents < 0) out.unattributedRefunds.push(p.id);
      continue;
    }
    if (matches.every((m) => m.prefixed)) out.prefixedPayments += 1; else out.barePayments += 1;
    const numbers = matches.map((m) => m.number);
    const named = numbers.map((n) => state.get(n));
    const foreign = p.clientKey == null ? [] : named.filter((i) => i.clientKey != null && i.clientKey !== p.clientKey);
    if (foreign.length) {
      const label = groupOf.get(p.clientKey);
      if (label == null || !foreign.every((i) => groupOf.get(i.clientKey) === label)) {
        out.crossClient.push({ paymentId: p.id, invoiceNumbers: numbers });
        continue;
      }
      out.sameGroup.push(p.id);
    }
    for (const i of named) i.paymentIds.push(p.id);
    if (p.clientKey == null || named.some((i) => i.clientKey == null)) {
      out.clientUnknownPayments += 1;
      markUnclear(p, named, "client-unknown", out);
      continue;
    }
    out.attributedPayments += 1;
    if (named.length === 1) named[0].definiteCents += p.amountCents;
    else applyShared(p, named, out);
  }
  const list = [...state.values()].map((s) => ({
    number: s.number, totalCents: s.totalCents, clientKey: s.clientKey, status: statusOf(s), definiteCents: s.definiteCents, paymentIds: s.paymentIds,
  }));
  return {
    ...out, invoices: list,
    overpaid: list.filter((i) => i.definiteCents > i.totalCents).map((i) => i.number),
    netRefund: list.filter((i) => i.definiteCents < 0).map((i) => i.number),
  };
}

/**
 * The derived per-invoice open balances, as the balances step's export rows
 * ({ key, cents }, ascending). Paid and zero-total → 0, partial → total −
 * definite, unpaid → total. Unclear: `credit-definite` (default) credits only
 * money a payment named for that invoice alone (not a guess); `open` keeps the
 * whole total open. An overpaid invoice stays fully open either way (its
 * definite money is the suspect part). Every unclear invoice is in `review`.
 */
export function derivedBalances(result, { unclear = "credit-definite" } = {}) {
  if (!UNCLEAR_MODES.includes(unclear)) throw new Error(`unclear must be credit-definite or open (got ${unclear}).`);
  const overpaid = new Set(result.overpaid);
  const rows = [];
  const review = [];
  for (const i of [...result.invoices].sort((a, b) => a.number - b.number)) {
    const credited = Math.max(0, Math.min(i.definiteCents, i.totalCents));
    const isUnclear = i.status === MATCH_STATUS.unclear;
    if (isUnclear) review.push(i.number);
    const keepWhole = overpaid.has(i.number) || (isUnclear && unclear === "open");
    rows.push({ key: String(i.number), cents: keepWhole ? i.totalCents : i.totalCents - credited });
  }
  return { rows, review };
}
