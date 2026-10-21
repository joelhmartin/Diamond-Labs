import { recordNumber, invoiceStatusFor, INVOICE_NUMBER_FIELDS } from "./seazona-records.js";
import { centsOf, legacyIssueDay } from "./map-invoices.js";
import { normAccount } from "./owners.js";

/**
 * The cutover's go/no-go (spec "Parity report"): ids, counts and cents only,
 * never a name, address or line text. Clean only when every comparison
 * matches; otherwise `differences` names each failing comparison, for the user
 * to explain and accept or fix. Pure: parity-queries.js reads both sides.
 */
const LIST_CAP = 50;
const DIFF_CAP = 200;
const countBy = (list, key) => list.reduce((m, x) => m.set(key(x), (m.get(key(x)) ?? 0) + 1), new Map());
const sumBy = (list, f) => list.reduce((s, x) => s + f(x), 0);
const sameCounts = (a, b) => [...new Set([...a.keys(), ...b.keys()])].every((k) => (a.get(k) ?? 0) === (b.get(k) ?? 0));
const range = (nums) => (nums.length ? [Math.min(...nums), Math.max(...nums)] : null);

/** The calendar year of a "YYYY-MM-DD" day, or "unknown" (never a truncated word). */
export const yearOf = (day) => (typeof day === "string" && /^\d{4}/.test(day) ? day.slice(0, 4) : "unknown");

export function seazonaInvoiceFacts(summaries, details) {
  return summaries.map(({ seazonaId, payload }) => ({
    seazonaId,
    number: recordNumber(payload, INVOICE_NUMBER_FIELDS),
    status: invoiceStatusFor(payload.status),
    totalCents: centsOf(payload.total),
    year: yearOf(legacyIssueDay(payload, details.get(seazonaId) ?? null).day),
  }));
}

/** An export → owed cents per account (credits count as 0: they are reported, never loaded). */
export function exportBalances(rows, mode, accountByInvoiceNumber) {
  const out = new Map();
  for (const r of rows) {
    const key = mode === "per-client" ? normAccount(r.key) ?? String(r.key) : (accountByInvoiceNumber.get(r.key) ?? `invoice ${r.key}`);
    out.set(key, (out.get(key) ?? 0) + Math.max(r.cents, 0));
  }
  return out;
}

/** The credit side of an export, as positive cents (what `exportBalances` clamps to zero). */
export const exportCreditCents = (rows) => rows.reduce((n, r) => n + (r.cents < 0 ? -r.cents : 0), 0);

function compareBalances(seazona, app) {
  const exported = seazona.balanceByAccount;
  if (!exported) return null;
  const derived = app.balanceByAccount;
  const keys = [...new Set([...exported.keys(), ...derived.keys()])].sort();
  const all = keys
    .map((client) => ({ client, exportCents: exported.get(client) ?? 0, appCents: derived.get(client) ?? 0 }))
    .filter((d) => d.exportCents !== d.appCents);
  const exportTotalCents = sumBy([...exported.values()], (c) => c);
  const appTotalCents = sumBy([...derived.values()], (c) => c);
  const unownedOpenCents = app.unowned?.openCents ?? 0;
  return {
    exportTotalCents,
    appTotalCents,
    appOwnedOpenCents: appTotalCents - unownedOpenCents,
    appUnownedOpenCents: unownedOpenCents,
    creditCents: seazona.exportCreditCents ?? 0,
    // Every cent of difference, by cause: export > app (the system shows less), app > export (it shows more).
    breakdown: {
      exportAboveAppCents: sumBy(all.filter((d) => d.exportCents > d.appCents), (d) => d.exportCents - d.appCents),
      appAboveExportCents: sumBy(all.filter((d) => d.appCents > d.exportCents), (d) => d.appCents - d.exportCents),
      exportOnlyAccounts: all.filter((d) => d.appCents === 0).length,
      appOnlyAccounts: all.filter((d) => d.exportCents === 0).length,
    },
    differenceCount: all.length,
    differences: all.slice(0, DIFF_CAP),
  };
}

function unmatchedClients(seazonaIds, app) {
  const linked = new Set(app.linkedClientIds);
  return seazonaIds.filter((id) => !linked.has(id));
}

function invoiceSection(seazona, app, differences) {
  const sInv = seazona.invoices.filter((i) => i.number != null);
  const sYears = countBy(sInv, (i) => i.year);
  const aYears = countBy(app.invoices, (i) => i.year);
  const byYear = [...new Set([...sYears.keys(), ...aYears.keys()])].sort().map((year) => ({ year, seazona: sYears.get(year) ?? 0, app: aYears.get(year) ?? 0 }));
  if (!sameCounts(sYears, aYears)) differences.push("invoice counts");
  const seazonaTotalCents = sumBy(sInv.filter((i) => i.status !== "void"), (i) => i.totalCents ?? 0);
  const appTotalCents = sumBy(app.invoices.filter((i) => i.status !== "void"), (i) => i.totalCents);
  if (seazonaTotalCents !== appTotalCents) differences.push("invoice totals");
  const loaded = new Set(app.invoices.map((i) => i.seazonaId));
  const missing = seazona.invoices.filter((i) => !loaded.has(i.seazonaId)).map((i) => i.seazonaId);
  if (missing.length) differences.push("invoices not loaded");
  // AR skips invoices with no client, so an unowned balance is money nobody can see or pay.
  const unowned = app.unowned ?? { count: 0, openCents: 0, invoiceNumbers: [] };
  if (unowned.openCents > 0) differences.push("unowned invoices with a balance");
  return {
    seazonaCount: sInv.length, appCount: app.invoices.length, byYear, seazonaTotalCents, appTotalCents,
    numberRange: { seazona: range(sInv.map((i) => i.number)), app: range(app.invoices.map((i) => i.number)) },
    missingCount: missing.length, missingIds: missing.slice(0, LIST_CAP), openingInvoices: app.openingInvoices,
    unowned: { count: unowned.count, openCents: unowned.openCents, invoiceNumbers: unowned.invoiceNumbers.slice(0, LIST_CAP) },
    historyWithoutSettlement: app.historyWithoutSettlement ?? null,
  };
}

function orderSection(seazona, app, differences) {
  const sOpen = countBy(seazona.orders.filter((o) => o.open), (o) => o.status);
  const aOpen = countBy(app.openOrders, (o) => o.status);
  if (!sameCounts(sOpen, aOpen)) differences.push("open orders");
  const loadedIds = new Set(app.orderIds ?? []);
  const missingOrders = seazona.orders.filter((o) => !loadedIds.has(o.id)).map((o) => o.id);
  if (missingOrders.length) differences.push("orders not loaded");
  const orderCount = app.orderCount ?? loadedIds.size;
  const unownedOrders = app.unownedOrders ?? [];
  // Unowned legacy orders, by the Seazona CLIENT id (ids only; a fixed link + re-run of `orders` attaches them).
  const clientOf = new Map(seazona.orders.map((o) => [o.id, o.clientId ?? "none"]));
  const byClient = new Map();
  for (const o of unownedOrders) {
    const c = clientOf.get(o.sourceId) ?? "unknown";
    const e = byClient.get(c) ?? { clientId: c, orders: 0, open: 0 };
    e.orders += 1;
    if (o.open) e.open += 1;
    byClient.set(c, e);
  }
  const unownedByClient = [...byClient.values()].sort((a, b) => String(a.clientId).localeCompare(String(b.clientId)));
  if (unownedByClient.some((e) => e.open > 0)) differences.push("unowned open orders");
  return {
    seazonaCount: seazona.orders.length, appCount: orderCount,
    seazonaOpen: Object.fromEntries(sOpen), appOpen: Object.fromEntries(aOpen),
    missingCount: missingOrders.length, missingIds: missingOrders.slice(0, LIST_CAP),
    unownedCount: unownedOrders.length, unownedByClient: unownedByClient.slice(0, DIFF_CAP),
  };
}

export function buildParity({ seazona, app, seeds }) {
  const differences = [];
  const unlinked = unmatchedClients(seazona.clientIds, app);
  if (unlinked.length) differences.push("clients");
  const invoices = invoiceSection(seazona, app, differences);

  const balances = compareBalances(seazona, app);
  if (!balances) differences.push("no balance export compared");
  else if (balances.differenceCount || balances.exportTotalCents !== balances.appTotalCents) differences.push("balances");
  const exportProblems = seazona.exportProblems ?? [];
  if (exportProblems.length) differences.push("balance export problems");

  const orders = orderSection(seazona, app, differences);
  if (seeds.errors.length) differences.push("seeds");

  return {
    clients: { seazona: seazona.clientIds.length, linked: app.linkedCount, placeholders: app.placeholders, unlinked: unlinked.length, unlinkedIds: unlinked.slice(0, LIST_CAP) },
    invoices,
    balances,
    exportProblems,
    orders,
    seeds,
    differences,
    clean: differences.length === 0,
  };
}

/** Every difference kind buildParity can raise: the names `--accept` takes. */
export const DIFFERENCE_KINDS = [
  "clients", "invoice counts", "invoice totals", "invoices not loaded", "unowned invoices with a balance",
  "balances", "no balance export compared", "balance export problems",
  "open orders", "orders not loaded", "unowned open orders", "seeds",
];

/**
 * Moves the named differences from `differences` to `accepted` (the user's
 * explicit sign-off, recorded in the report). `clean` then means no UNACCEPTED
 * difference remains. Accepting nothing returns the report unchanged; an
 * unknown kind throws (a typo must not silently accept nothing or everything).
 */
export function applyAccepted(report, kinds = []) {
  const unknown = kinds.filter((k) => !DIFFERENCE_KINDS.includes(k));
  if (unknown.length) throw new RangeError(`Unknown difference kind(s): ${unknown.join(", ")}. Known: ${DIFFERENCE_KINDS.join(", ")}.`);
  if (!kinds.length) return report;
  const differences = report.differences.filter((d) => !kinds.includes(d));
  return { ...report, accepted: report.differences.filter((d) => kinds.includes(d)), differences, clean: differences.length === 0 };
}
