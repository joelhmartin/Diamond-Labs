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
 * Admin › Accounts receivable: one row per practice account with a balance
 * (worst past due first), plus a totals row that follows the filter. An issued
 * invoice with a client but no practice account (unstamped history) is still
 * money the lab is owed: staff see it as an "Unassigned" row per client
 * (accountId null, no group, `unassigned: true`). Guest shop invoices (neither)
 * never appear.
 *
 * @param {Array<{ accountId: string|null, dueDate: string|null, balanceCents: number }>} openInvoices
 * @param {Map<string, { name?: string, accountNumber?: string, ownerUserId?: string }>} practicesById
 * @param {Map<string, { id: string, name: string }>} [organizationOf] account id → its group (organizationOf of the organizations module)
 * @param {Map<string, { name?: string, practice?: string, accountNumber?: string }>} [clientsById] client user id → name, for the unassigned rows
 */
export function buildReceivables(openInvoices, practicesById, asOfIso, { pastDueOnly = false, organizationOf = new Map(), clientsById = new Map() } = {}) {
  const byKey = new Map();
  for (const inv of openInvoices) {
    const key = inv.accountId ? `a:${inv.accountId}` : inv.clientUserId ? `u:${inv.clientUserId}` : null;
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(inv);
  }
  const rows = [];
  for (const [key, items] of byKey) {
    const accountId = key.startsWith("a:") ? key.slice(2) : null;
    const aged = ageBalances(items, asOfIso);
    if (aged.totalCents <= 0) continue;
    const pastDueCents = aged.totalCents - aged.buckets.current;
    if (pastDueOnly && pastDueCents <= 0) continue;
    const clientUserId = accountId ? null : items[0].clientUserId;
    const c = clientUserId ? clientsById.get(clientUserId) ?? {} : {};
    const p = accountId ? practicesById.get(accountId) ?? {} : { name: c.practice ?? c.name, accountNumber: c.accountNumber, ownerUserId: clientUserId };
    const org = accountId ? organizationOf.get(accountId) : null;
    rows.push({
      accountId, unassigned: !accountId, name: p.name ?? null, accountNumber: p.accountNumber ?? null, ownerUserId: p.ownerUserId ?? null,
      organizationId: org?.id ?? null, organizationName: org?.name ?? null,
      balanceCents: aged.totalCents, pastDueCents, buckets: aged.buckets, oldestDueDate: aged.oldestDueDate,
      openInvoices: items.filter((i) => i.balanceCents > 0).length,
    });
  }
  rows.sort((a, b) => b.pastDueCents - a.pastDueCents || b.balanceCents - a.balanceCents || String(a.name ?? "").localeCompare(String(b.name ?? "")));
  const totals = { balanceCents: 0, pastDueCents: 0, buckets: emptyBuckets() };
  for (const r of rows) {
    totals.balanceCents += r.balanceCents;
    totals.pastDueCents += r.pastDueCents;
    for (const k of AGING_KEYS) totals.buckets[k] += r.buckets[k];
  }
  return { rows, totals, asOf: asOfIso };
}

/**
 * The group rollup of receivables rows: one entry per group (organization)
 * that has a row, its buckets and totals the sum of its practices' rows (so a
 * group's total can never disagree with them). Rows without a group are not in
 * any entry: callers show them as plain rows. Worst past due first.
 * @returns {Array<{ organizationId, name, balanceCents, totalCents, pastDueCents, buckets, oldestDueDate, openInvoices, accountIds }>}
 */
export function rollupGroups(rows) {
  const groups = new Map();
  for (const r of rows) {
    if (!r.organizationId) continue;
    if (!groups.has(r.organizationId)) {
      groups.set(r.organizationId, {
        organizationId: r.organizationId, name: r.organizationName, balanceCents: 0, totalCents: 0, pastDueCents: 0,
        buckets: emptyBuckets(), oldestDueDate: null, openInvoices: 0, accountIds: [],
      });
    }
    const g = groups.get(r.organizationId);
    g.balanceCents += r.balanceCents;
    g.totalCents += r.balanceCents; // same number as balanceCents: balanceCents keeps the group row shaped like a practice row (the table's columns), totalCents is the rollup's own name
    g.pastDueCents += r.pastDueCents;
    for (const k of AGING_KEYS) g.buckets[k] += r.buckets[k];
    if (r.oldestDueDate && (!g.oldestDueDate || r.oldestDueDate < g.oldestDueDate)) g.oldestDueDate = r.oldestDueDate;
    g.openInvoices += r.openInvoices;
    g.accountIds.push(r.accountId);
  }
  return [...groups.values()].sort((a, b) => b.pastDueCents - a.pastDueCents || b.balanceCents - a.balanceCents || String(a.name).localeCompare(String(b.name)));
}
