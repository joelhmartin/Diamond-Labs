import { AGING_BUCKETS } from "@my-app/shared";

/**
 * Aging: how far past due each open balance is, in the five buckets the
 * statement and the AR page print. Pure; dates are lab-local "YYYY-MM-DD".
 */
export const AGING_KEYS = AGING_BUCKETS.map((b) => b.key);

const DAY_MS = 86_400_000;
const dayNumber = (iso) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;

/** Calendar days from the due date to asOf (0 = due today; negative = not yet due). */
export function daysPastDue(dueDate, asOfIso) {
  if (!dueDate) return 0;
  return Math.round(dayNumber(asOfIso) - dayNumber(dueDate));
}

export function agingKeyFor(dueDate, asOfIso) {
  const d = daysPastDue(dueDate, asOfIso);
  if (d <= 0) return "current";
  if (d <= 30) return "d1_30";
  if (d <= 60) return "d31_60";
  if (d <= 90) return "d61_90";
  return "d90_plus";
}

const emptyBuckets = () => Object.fromEntries(AGING_KEYS.map((k) => [k, 0]));

/** @param {Array<{ dueDate: string|null, balanceCents: number }>} items */
export function ageBalances(items, asOfIso) {
  const buckets = emptyBuckets();
  let totalCents = 0;
  let oldestDueDate = null;
  for (const it of items) {
    if (!it.balanceCents) continue;
    buckets[agingKeyFor(it.dueDate, asOfIso)] += it.balanceCents;
    totalCents += it.balanceCents;
    if (it.balanceCents > 0 && it.dueDate && (!oldestDueDate || it.dueDate < oldestDueDate)) oldestDueDate = it.dueDate;
  }
  return { buckets, totalCents, oldestDueDate };
}

/**
 * Admin › Accounts receivable: one row per client with a balance (worst past
 * due first), plus a totals row that follows the filter. Guest invoices
 * (no client) never appear.
 *
 * @param {Array<{ clientUserId: string|null, dueDate: string|null, balanceCents: number }>} openInvoices
 * @param {Map<string, { name?: string, practice?: string, accountNumber?: string }>} clientsById
 */
export function buildReceivables(openInvoices, clientsById, asOfIso, { pastDueOnly = false } = {}) {
  const byClient = new Map();
  for (const inv of openInvoices) {
    if (!inv.clientUserId) continue;
    if (!byClient.has(inv.clientUserId)) byClient.set(inv.clientUserId, []);
    byClient.get(inv.clientUserId).push(inv);
  }
  const rows = [];
  for (const [clientUserId, items] of byClient) {
    const aged = ageBalances(items, asOfIso);
    if (aged.totalCents <= 0) continue;
    const pastDueCents = aged.totalCents - aged.buckets.current;
    if (pastDueOnly && pastDueCents <= 0) continue;
    const c = clientsById.get(clientUserId) ?? {};
    rows.push({
      clientUserId, name: c.name ?? null, practice: c.practice ?? null, accountNumber: c.accountNumber ?? null,
      balanceCents: aged.totalCents, pastDueCents, buckets: aged.buckets, oldestDueDate: aged.oldestDueDate,
      openInvoices: items.filter((i) => i.balanceCents > 0).length,
    });
  }
  rows.sort((a, b) => b.pastDueCents - a.pastDueCents || b.balanceCents - a.balanceCents
    || String(a.practice ?? a.name ?? "").localeCompare(String(b.practice ?? b.name ?? "")));
  const totals = { balanceCents: 0, pastDueCents: 0, buckets: emptyBuckets() };
  for (const r of rows) {
    totals.balanceCents += r.balanceCents;
    totals.pastDueCents += r.pastDueCents;
    for (const k of AGING_KEYS) totals.buckets[k] += r.buckets[k];
  }
  return { rows, totals, asOf: asOfIso };
}
