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
 * payment names it. Nothing here forgives a balance on a guess: an unclear
 * invoice stays fully open unless the operator chooses otherwise.
 */

export const MATCH_STATUS = { paid: "paid", partial: "partial", unclear: "unclear", unpaid: "unpaid" };

/** The widest range ("12345-12348") that expands into the numbers between its ends. */
export const MAX_RANGE_SPAN = 10;

// Money and decimals are blanked first so "$12,345.00" never reads as invoice 12345.
const MONEY = /\$\s*[\d,]*\d(?:\.\d+)?|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+\.\d+\b/g;
// A number with an optional remake suffix ("12345R", "12346r2"): the suffix is dropped.
const NUMBER = /(\d+)(?:[A-Za-z]+\d*)?/g;
const RANGE = /(\d+)(?:[A-Za-z]+\d*)?\s*[-–—]\s*(\d+)/g;

const asNumber = (digits) => (digits.length <= 9 ? Number(digits) : null);

/**
 * The distinct invoice numbers `text` names that are in `knownNumbers` (a Set
 * of integers), ascending. Unknown numbers are ignored, which drops check
 * numbers, dates and phone numbers. A range expands only when both ends are
 * known and it spans at most MAX_RANGE_SPAN.
 */
export function extractInvoiceNumbers(text, knownNumbers) {
  const clean = String(text ?? "").replace(MONEY, " ");
  const found = new Set();
  for (const m of clean.matchAll(NUMBER)) {
    const n = asNumber(m[1]);
    if (n != null && knownNumbers.has(n)) found.add(n);
  }
  for (const m of clean.matchAll(RANGE)) {
    const [a, b] = [asNumber(m[1]), asNumber(m[2])];
    if (a == null || b == null || !knownNumbers.has(a) || !knownNumbers.has(b) || b <= a || b - a > MAX_RANGE_SPAN) continue;
    for (let n = a; n <= b; n++) if (knownNumbers.has(n)) found.add(n);
  }
  return [...found].sort((x, y) => x - y);
}

/** Per invoice from its accumulated state. A definite sum at or over the total wins over any unclear share. */
function statusOf(state) {
  if (state.definiteCents >= state.totalCents) return MATCH_STATUS.paid;
  if (state.unclear) return MATCH_STATUS.unclear;
  return state.definiteCents > 0 ? MATCH_STATUS.partial : MATCH_STATUS.unpaid;
}

/** A payment naming several invoices: definite only when it is exactly their sum (or minus it, for a refund). */
function applyShared(payment, named, out) {
  const sum = named.reduce((n, i) => n + i.totalCents, 0);
  const sign = sum !== 0 && payment.amountCents === sum ? 1 : sum !== 0 && payment.amountCents === -sum ? -1 : 0;
  if (sign) {
    for (const i of named) i.definiteCents += sign * i.totalCents;
    return;
  }
  for (const i of named) i.unclear = true;
  out.unclearPayments.push({ paymentId: payment.id, invoiceNumbers: named.map((i) => i.number) });
}

/**
 * invoices: [{ number, totalCents, clientKey }]; payments: [{ id, date,
 * amountCents, clientKey|null, text }] (text = reference + notes). A payment
 * whose clientKey is known and differs from a named invoice's is cross-client:
 * reported, never applied. A negative amount (refund) subtracts.
 * → { invoices: [{ number, totalCents, clientKey, status, definiteCents, paymentIds }],
 *     attributedPayments, unattributedPayments: [id], crossClient: [{ paymentId, invoiceNumbers }],
 *     unclearPayments: [{ paymentId, invoiceNumbers }], overpaid: [number] }
 */
export function matchPayments({ invoices, payments }) {
  const state = new Map(invoices.map((i) => [i.number, { ...i, definiteCents: 0, unclear: false, paymentIds: [] }]));
  const known = new Set(state.keys());
  const out = { attributedPayments: 0, unattributedPayments: [], crossClient: [], unclearPayments: [] };
  for (const p of payments) {
    const numbers = extractInvoiceNumbers(p.text, known);
    if (!numbers.length) { out.unattributedPayments.push(p.id); continue; }
    const named = numbers.map((n) => state.get(n));
    if (p.clientKey != null && named.some((i) => i.clientKey != null && i.clientKey !== p.clientKey)) {
      out.crossClient.push({ paymentId: p.id, invoiceNumbers: numbers });
      continue;
    }
    out.attributedPayments += 1;
    for (const i of named) i.paymentIds.push(p.id);
    if (named.length === 1) named[0].definiteCents += p.amountCents;
    else applyShared(p, named, out);
  }
  const list = [...state.values()].map((s) => ({
    number: s.number, totalCents: s.totalCents, clientKey: s.clientKey, status: statusOf(s), definiteCents: s.definiteCents, paymentIds: s.paymentIds,
  }));
  return { ...out, invoices: list, overpaid: list.filter((i) => i.definiteCents > i.totalCents).map((i) => i.number) };
}

/**
 * The derived per-invoice open balances, as the balances step's export rows
 * ({ key, cents }, ascending). Paid → 0, partial → total − definite, unpaid →
 * total. Unclear: `open` (default) keeps the whole total open (never forgive a
 * balance on a guess); `review` credits only its definite part. Either way
 * every unclear invoice is in `review`.
 */
export function derivedBalances(result, { unclear = "open" } = {}) {
  if (unclear !== "open" && unclear !== "review") throw new Error(`unclear must be open or review (got ${unclear}).`);
  const rows = [];
  const review = [];
  for (const i of [...result.invoices].sort((a, b) => a.number - b.number)) {
    const credited = Math.max(0, Math.min(i.definiteCents, i.totalCents));
    const isUnclear = i.status === MATCH_STATUS.unclear;
    if (isUnclear) review.push(i.number);
    rows.push({ key: String(i.number), cents: isUnclear && unclear === "open" ? i.totalCents : i.totalCents - credited });
  }
  return { rows, review };
}
