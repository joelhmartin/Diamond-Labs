/**
 * The definitions the lab's reports share, and the single source for the money
 * figures reports and dashboard tiles show (spec "Definitions the lab reports
 * share"). Every metric takes the db/tx first and returns plain numbers;
 * dates are lab-local "YYYY-MM-DD" days (LAB_TIMEZONE), never UTC days.
 *
 * Sales = the subtotal (goods and adjustments; no tax, no shipping) of issued
 * invoices, dated by the lab-local day of issued_at. Drafts and voids are not
 * sales. Legacy invoices count, except piece 5's opening-balance invoices: they
 * carry a client's AR balance at cutover, not a sale made that day.
 */
import { sql } from "drizzle-orm";
import { OPENING_BALANCE_PREFIX, daysBetween, monthsBetween } from "@my-app/shared";
import { invoices, invoiceLines, users, doctorProfiles } from "../../../db/schema/index.js";
import { labDay, labDayBetween, labDayText, labMonthText } from "../../../lib/lab-day-sql.js";
import { ledgerRowDay } from "../../billing/ledger.service.js";

// The lab-day SQL helpers live in lib/lab-day-sql.js (billing uses them too); re-exported for the report glue.
export { labDay, labDayBetween, labDayText, labMonthText };

// ── Links (the admin web routes, apps/web/src/config/routes.js) ──────────

/** A client's invoices: the admin invoice list scoped to one client (there is no client detail page). */
export const CLIENT_LINK = "/admin/invoices?inv.clientUserId={clientUserId}";
/** One invoice: ROUTES.ADMIN_INVOICE_DETAIL. */
export const INVOICE_LINK = "/admin/invoices/{invoiceId}";

// ── SQL building blocks ──────────────────────────────────────────────────

/** A client's display name: the practice, falling back to the doctor's name. Join users + doctor_profiles. */
export const clientName = sql`coalesce(${doctorProfiles.companyName}, ${users.name})`;

/** The invoice is a sale (status and opening-balance rule; no date). */
export const isSale = sql`${invoices.status} = 'issued' and not (${invoices.kind} = 'legacy' and coalesce(${invoices.legacySeazonaInvoiceId}, '') like ${`${OPENING_BALANCE_PREFIX}%`})`;

/** Sales invoices issued on lab-local days `from`..`to`, optionally for one client. */
export function salesWhere({ from, to, clientUserId }) {
  const parts = [isSale, labDayBetween(invoices.issuedAt, { from, to })];
  if (clientUserId) parts.push(sql`${invoices.clientUserId} = ${clientUserId}`);
  return sql.join(parts, sql` and `);
}

/**
 * A discount line: a negative adjustment the lab entered (spec: Discounts).
 * Imported lines (price_source 'legacy', import/map-invoices.js) are not:
 * the import types any negative Seazona line, and its balancing "Seazona
 * adjustment (discounts, services, rounding)" line, as an adjustment.
 */
export const isDiscountLine = sql`${invoiceLines.kind} = 'adjustment' and ${invoiceLines.lineCents} < 0 and ${invoiceLines.priceSource} <> 'legacy'`;

/** A ledger row's lab-local day (billing/ledger.service.js ledgerRowDay, the statement's rule). */
export const paymentDay = ledgerRowDay;

/** The JS side of `clientName` for rows from loadClientNames / listReceivables. */
export const clientLabel = (c) => c?.practice ?? c?.name ?? null;

/** Rows from `execute` (postgres-js returns an array; other drivers `{ rows }`). */
export async function rowsOf(db, query) {
  const result = await db.execute(query);
  return (result?.rows ?? result) || [];
}

/** SQL sums and counts arrive as strings; null means none. */
export const num = (v) => (v === null || v === undefined ? 0 : Number(v));

/**
 * ORDER BY + LIMIT/OFFSET for a server-paged report. `sorts` maps a column id
 * to its SQL expression; an unknown or absent sort falls back to `fallback`
 * ({ id, desc }). The unique `tiebreak` keeps paging (and the CSV export, which
 * pages by offset) deterministic.
 */
export function orderAndPage(page, sorts, fallback, tiebreak) {
  const s = page?.sort && sorts[page.sort.id] ? page.sort : fallback;
  const dir = sql.raw(s.desc ? "desc" : "asc");
  return sql`order by ${sorts[s.id]} ${dir} nulls last, ${tiebreak} ${dir} limit ${page?.limit ?? 50} offset ${page?.offset ?? 0}`;
}

// ── Metrics (reports and dashboard tiles) ────────────────────────────────

/** Sales cents for lab-local days `from`..`to` (optionally one client). */
export async function salesCents(db, { from, to, clientUserId } = {}) {
  const [r] = await rowsOf(db, sql`select coalesce(sum(${invoices.subtotalCents}), 0) as "cents" from ${invoices} where ${salesWhere({ from, to, clientUserId })}`);
  return num(r?.cents);
}

/** Sales per lab-local day, every day in the range (zeros filled). */
export async function salesByDay(db, { from, to }) {
  const rows = await rowsOf(db, sql`
    select ${labDayText(invoices.issuedAt)} as "day", sum(${invoices.subtotalCents}) as "cents", count(*) as "invoices"
    from ${invoices} where ${salesWhere({ from, to })} group by 1 order by 1`);
  const byDay = new Map(rows.map((r) => [String(r.day), r]));
  return daysBetween(from, to).map((day) => ({ day, cents: num(byDay.get(day)?.cents), invoices: num(byDay.get(day)?.invoices) }));
}

/** Sales per lab-local month ("YYYY-MM"), every month the range touches (zeros filled). */
export async function salesByMonth(db, { from, to }) {
  const rows = await rowsOf(db, sql`
    select ${labMonthText(invoices.issuedAt)} as "month", sum(${invoices.subtotalCents}) as "cents"
    from ${invoices} where ${salesWhere({ from, to })} group by 1 order by 1`);
  const byMonth = new Map(rows.map((r) => [String(r.month), num(r.cents)]));
  return monthsBetween(from, to).map((month) => ({ month, cents: byMonth.get(month) ?? 0 }));
}

/**
 * Gross, discounts, net (= sales), tax, shipping and total for a range.
 * Discounts are the negative `adjustment` lines (a negative number). A remake
 * is priced at zero when it is drafted and the price it would have had is not
 * stored, so its reduction cannot be counted. Gross = net − discounts, so the
 * three always reconcile with the invoices' subtotals.
 */
export async function salesBreakdown(db, { from, to }) {
  const [r = {}] = await rowsOf(db, sql`
    select coalesce(sum(${invoices.subtotalCents}), 0) as "net", coalesce(sum(neg.cents), 0) as "discount",
      coalesce(sum(${invoices.taxCents}), 0) as "tax", coalesce(sum(${invoices.shippingCents}), 0) as "shipping",
      coalesce(sum(${invoices.totalCents}), 0) as "total", count(*) as "invoices"
    from ${invoices}
    left join (
      select ${invoiceLines.invoiceId} as invoice_id, sum(${invoiceLines.lineCents}) as cents from ${invoiceLines}
      where ${isDiscountLine} group by 1
    ) neg on neg.invoice_id = ${invoices.id}
    where ${salesWhere({ from, to })}`);
  const netCents = num(r.net);
  const discountCents = num(r.discount);
  return {
    grossCents: netCents - discountCents, discountCents, netCents,
    taxCents: num(r.tax), shippingCents: num(r.shipping), totalCents: num(r.total), invoices: num(r.invoices),
  };
}

/** The notice the remake reduction gap needs wherever discounts are shown. */
export const REMAKE_DISCOUNT_NOTICE =
  "Discounts are negative adjustment lines. A remake is billed at $0 and the price it would have had is not stored, so remake reductions are not included.";

/**
 * Imported invoices carry no itemised discounts, so a range that starts before
 * cutover (or any range while REPORTS_COVERAGE_FROM is unset, i.e. before
 * cutover is recorded) undercounts them.
 */
export function discountCoverageNotice(range, coverageFrom = process.env.REPORTS_COVERAGE_FROM) {
  if (coverageFrom && range?.from && range.from >= coverageFrom) return null;
  const since = coverageFrom ? ` (before ${coverageFrom})` : "";
  return `Discounts on invoices imported from Seazona${since} are not itemised, so they are not counted as discounts; those invoices' net sales are complete.`;
}

/** Every notice a discount figure needs, joined (always includes the remake gap). */
export const discountNotices = (range) => [REMAKE_DISCOUNT_NOTICE, discountCoverageNotice(range)].filter(Boolean).join(" ");

/**
 * Product-level coverage: before cutover most imported invoices carry one
 * summary line, so product/category figures are complete only from
 * REPORTS_COVERAGE_FROM (an ISO date set at cutover; unset = no note).
 */
export function coverageNotice(range, coverageFrom = process.env.REPORTS_COVERAGE_FROM) {
  if (!coverageFrom || !range?.from || range.from >= coverageFrom) return null;
  return `Product detail is complete from ${coverageFrom}. Most invoices before then were imported as one summary line, so they count as "No product" here. Money totals by day, month and client are complete.`;
}
