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
import { alias } from "drizzle-orm/pg-core";
import { LAB_TIMEZONE, OPENING_BALANCE_PREFIX, daysInRange, isoDateIn, monthsBetween } from "@my-app/shared";
import { invoices, invoiceLines, users, doctorProfiles, labOrders, productVariants, productFamilies } from "../../../db/schema/index.js";
import { afterLabDay, labDay, labDayBetween, labDayText, labMonthText } from "../../../lib/lab-day-sql.js";
import { ledgerRowDay, ledgerRowDayBetween } from "../../billing/ledger.service.js";
import { getCalendar } from "../../../modules/business-calendar/service.js";

// The lab-day SQL helpers live in lib/lab-day-sql.js (billing uses them too); re-exported for the report glue.
export { afterLabDay, labDay, labDayBetween, labDayText, labMonthText };

// ── Links (the admin web routes, apps/web/src/config/routes.js) ──────────

/** A client's invoices: the admin invoice list scoped to one client (there is no client detail page). */
export const CLIENT_LINK = "/admin/invoices?inv.clientUserId={clientUserId}";
/** One invoice: ROUTES.ADMIN_INVOICE_DETAIL. */
export const INVOICE_LINK = "/admin/invoices/{invoiceId}";
/** One lab order: ROUTES.LAB_ORDER_DETAIL (admin and lab staff). The row needs `labOrderId`. */
export const ORDER_LINK = "/lab/orders/{labOrderId}";

/**
 * The lab day a report runs on: the runner's ctx.today (lab-local, from the
 * configured tz), else ctx.now's lab day, else today's. Called without ctx it
 * is the lab's today (for param defaults computed at definition time).
 */
export const labToday = (ctx) => ctx?.today ?? isoDateIn(LAB_TIMEZONE, ctx?.now ?? new Date());

// ── SQL building blocks ──────────────────────────────────────────────────

/** A client's display name: the practice, falling back to the doctor's name. Join users + doctor_profiles. */
export const clientName = sql`coalesce(${doctorProfiles.companyName}, ${users.name})`;

/** The user is a client (spec: Client = a user with role doctor). */
export const isClient = sql`${users.role} = 'doctor'`;

/** The lab order counts (spec: cancelled orders are excluded unless a report says otherwise). */
export const isLiveOrder = sql`${labOrders.status} <> 'cancelled'`;

/** The lab's business calendar (piece 7 getCalendar), read in the report's own transaction. */
export const labCalendar = (db) => getCalendar(db);

const WEEKDAY_RE = /^[0-6]$/;
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Open days in (fromDay, toDay] for two SQL date expressions: the SQL twin of
 * piece 7's `businessDaysBetween`, never below 0. Closed weekdays and holidays
 * come from `calendar` and are written as literals (validated digits and
 * dates, never user input). A calendar with neither is plain day arithmetic.
 */
export function businessDaysSql(fromDay, toDay, calendar) {
  const closed = [...new Set((calendar?.closedWeekdays ?? []).map(String))].filter((d) => WEEKDAY_RE.test(d));
  const holidays = [...(calendar?.holidays ?? [])].filter((d) => ISO_DAY_RE.test(d));
  if (!closed.length && !holidays.length) return sql`greatest(0, ${toDay} - ${fromDay})`;
  const open = [];
  if (closed.length) open.push(sql.raw(`extract(dow from g.d)::int not in (${closed.join(", ")})`));
  if (holidays.length) open.push(sql.raw(`g.d::date not in (${holidays.map((d) => `'${d}'`).join(", ")})`));
  return sql`(select count(*)::int from generate_series((${fromDay} + 1)::timestamp, (${toDay})::timestamp, interval '1 day') as g(d) where ${sql.join(open, sql` and `)})`;
}

/**
 * Turnaround in business days (piece 7's calendar), received → shipped,
 * between the two lab-local days (spec "Turnaround"). THE turnaround
 * expression: `turnaroundDays(order, calendar)` is its JS twin and every
 * report averaging turnaround uses this. Pass the calendar from `labCalendar`.
 */
export const turnaroundDaysSql = (calendar) => businessDaysSql(labDay(labOrders.receivedAt), labDay(labOrders.shippedAt), calendar);

/** A line's catalog variant when it names only a code (imported lines). See `catalogJoins`. */
export const byCode = alias(productVariants, "by_code");

/**
 * Joins a line table (invoice_lines or lab_order_lines) to the catalog: its
 * variant, or for a line that names only a code (imported lines) the variant
 * with that code (`by_code`), and the family of whichever matched.
 */
export const catalogJoins = (line) => sql`
  left join ${productVariants} on ${productVariants.id} = ${line.variantId}
  left join ${productVariants} as by_code on ${line.variantId} is null and ${byCode.code} = ${line.code}
  left join ${productFamilies} on ${productFamilies.id} = coalesce(${productVariants.familyId}, ${byCode.familyId})`;

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

/** Ledger rows dated in a lab-day range (ledgerRowDayBetween: index-friendly, same rows as `paymentDay between`). */
export const paymentDayBetween = (range) => ledgerRowDayBetween(range);

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

/** Sales cents per client for lab-local days `from`..`to`: Map(clientUserId → cents). One grouped query. */
export async function salesByClient(db, { from, to }) {
  const rows = await rowsOf(db, sql`
    select ${invoices.clientUserId} as "clientUserId", sum(${invoices.subtotalCents}) as "cents"
    from ${invoices} where ${salesWhere({ from, to })} and ${invoices.clientUserId} is not null group by 1`);
  return new Map(rows.map((r) => [r.clientUserId, num(r.cents)]));
}

/** Sales per lab-local day, every day in the range (zeros filled). */
export async function salesByDay(db, { from, to }) {
  const rows = await rowsOf(db, sql`
    select ${labDayText(invoices.issuedAt)} as "day", sum(${invoices.subtotalCents}) as "cents", count(*) as "invoices"
    from ${invoices} where ${salesWhere({ from, to })} group by 1 order by 1`);
  const byDay = new Map(rows.map((r) => [String(r.day), r]));
  return daysInRange(from, to).map((day) => ({ day, cents: num(byDay.get(day)?.cents), invoices: num(byDay.get(day)?.invoices) }));
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

/**
 * THE coverage condition: the range reaches back before REPORTS_COVERAGE_FROM
 * (the cutover day), or cutover is not recorded yet (unset), so imported
 * history is in it. A range with no start counts as reaching back.
 */
export function beforeCoverage(range, coverageFrom = process.env.REPORTS_COVERAGE_FROM) {
  if (!coverageFrom || !range?.from) return true;
  return range.from < coverageFrom;
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
  if (!beforeCoverage(range, coverageFrom)) return null;
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
  // Unlike the discount and remake notes, this one stays quiet until cutover is recorded (spec: unset = no note).
  if (!coverageFrom || !beforeCoverage(range, coverageFrom)) return null;
  return `Product detail is complete from ${coverageFrom}. Most invoices before then were imported as one summary line, so they count as "No product" here. Money totals by day, month and client are complete.`;
}
