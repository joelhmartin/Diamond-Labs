/**
 * Lab-order figures the Operations, Productivity, Departments and Planning
 * reports share with the dashboards (spec "Definitions the lab reports
 * share"). One implementation per number: a report and the dashboard tile that
 * shows the same figure both call the function here.
 *
 * - Open        = not shipped and not cancelled (TERMINAL_LAB_STATUSES).
 * - Past due    = the SQL twin of the shared `isOverdue(dueDate, status, today)`:
 *                 open and due before today. An on-hold order past its due date
 *                 IS past due (isOverdue only exempts terminal statuses; the
 *                 board shows it red), and it is also counted as on hold.
 * - Board counts and at risk = piece 7's board (lab-schedule-queries
 *                 boardTiles / tileOrderIds): at risk is behind its workflow
 *                 plan, or due within AT_RISK_BUSINESS_DAYS business days (past
 *                 due included) and not yet in quality check; "tomorrow" is the
 *                 next open business day. `boardDayCounts` and `atRiskOrders`
 *                 both read it, so the tiles and the list always agree.
 * - Due soon    = due from today up to piece 7's at-risk cutoff (the same
 *                 business-day window), not already past due (Technician Workload).
 * - Turnaround  = business days received -> shipped (lab-metrics turnaroundDaysSql).
 *
 * "today" is the lab-local day the caller passes (the runner's ctx.today). The
 * board functions take `now` (a Date) and read the day in the calendar's zone, as the board does.
 */
import { sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  CARRIERS, LAB_STATUS_LABELS, LAB_TIMEZONE, TERMINAL_LAB_STATUSES, addDays, daysInRange, isoDateIn,
} from "@my-app/shared";
import { labOrders, labOrderLines, labDepartments, users, shipments, productFamilies } from "../../../db/schema/index.js";
import { DEFAULT_CALENDAR, businessDaysBetween } from "../../../modules/business-calendar/index.js";
import { boardTiles, tileOrderIds } from "../lab-schedule-queries.js";
import { atRiskCutoff } from "../lab-schedule-flags.js";
import {
  catalogJoins, clientName, isLiveOrder, labCalendar, labDay, labDayBetween, labDayText, num, rowsOf, turnaroundDaysSql,
} from "./lab-metrics.js";
import { optionalClientJoin, uncategorizedSql } from "./report-helpers.js";

// ── SQL building blocks ──────────────────────────────────────────────────

/** A literal SQL list of fixed status words ('a', 'b'): readable in the plan, never user input. */
const literalList = (words) => {
  if (!words.every((w) => /^[a-z_]+$/.test(w))) throw new Error("status words only");
  return sql.raw(words.map((w) => `'${w}'`).join(", "));
};

/** Open: not shipped and not cancelled (isTerminalLabStatus). */
export const isOpenOrder = sql`${labOrders.status} not in (${literalList(TERMINAL_LAB_STATUSES)})`;
export const isOnHold = sql`${labOrders.status} = 'on_hold'`;
/** isOverdue(dueDate, status, today) in SQL. */
export const pastDueSql = (today) => sql`${isOpenOrder} and ${labOrders.dueDate} < ${today}::date`;
/** Open and due on `day`. */
export const dueOnSql = (day) => sql`${isOpenOrder} and ${labOrders.dueDate} = ${day}::date`;
/**
 * Due from `today` up to (not including) piece 7's at-risk cutoff for that day
 * (`atRiskCutoff`: AT_RISK_BUSINESS_DAYS open days ahead), so "due soon" is
 * the business-day window of the board's at-risk rule, minus the past due.
 */
export const dueSoonSql = (today, calendar) =>
  sql`${labOrders.dueDate} >= ${today}::date and ${labOrders.dueDate} < ${atRiskCutoff(today, calendar ?? DEFAULT_CALENDAR)}::date`;

/** The person an order is assigned to (a second users join). */
export const assignee = alias(users, "assignee");
export const UNASSIGNED = "Unassigned";
export const NO_DEPARTMENT = "No department";
export const assigneeName = sql`coalesce(${assignee.name}, ${UNASSIGNED})`;
export const departmentName = sql`coalesce(${labDepartments.name}, ${NO_DEPARTMENT})`;

/** The order's assignee (`assignee`) and department; left joins. */
export const assigneeJoin = sql`left join ${users} as assignee on assignee.id = ${labOrders.assigneeUserId}`;
export const departmentJoin = sql`left join ${labDepartments} on ${labDepartments.id} = ${labOrders.departmentId}`;

/** Joins an order to its client (+ profile), assignee and department; all left joins. */
export const orderJoins = sql`
  ${optionalClientJoin(labOrders.clientUserId)}
  ${assigneeJoin}
  ${departmentJoin}`;

/** Department rows: by department (position order), "No department" last. Use with departmentJoin. */
export const byDepartment = sql`${labOrders.departmentId}, ${labDepartments.name}, ${labDepartments.position}`;
export const departmentOrder = sql`(${labOrders.departmentId} is null), ${labDepartments.position}, ${labDepartments.name}`;

/** `u.units`: the order's product units (build-instruction lines are not units). */
export const unitsJoin = sql`
  left join lateral (
    select coalesce(sum(${labOrderLines.qty}), 0) as units from ${labOrderLines}
    where ${labOrderLines.labOrderId} = ${labOrders.id} and ${labOrderLines.noteOnly} = false
  ) u on true`;

/** ` and <practice/group filter on the order>` for an optional practiceScope (report-helpers), else nothing. */
export const andScope = (scope) => (scope ? sql` and ${scope(labOrders.accountId)}` : sql``);

/** A lab status as a badge cell. */
export const statusBadge = (s) => (s ? { value: s, label: LAB_STATUS_LABELS[s] ?? s } : null);

// ── Turnaround ───────────────────────────────────────────────────────────

const labDayOf = (v) => (v == null ? null : isoDateIn(LAB_TIMEZONE, new Date(v)));

/**
 * Turnaround of one order in business days (piece 7's businessDaysBetween:
 * open days after the received day up to the shipped day), between lab-local
 * days; null when it has not shipped or was cancelled. The JS twin of
 * lab-metrics `turnaroundDaysSql(calendar)` (reports average that in SQL).
 * With no calendar every day is open (plain calendar days).
 */
export function turnaroundDays(order, calendar = DEFAULT_CALENDAR) {
  if (!order?.shippedAt || !order.receivedAt || order.status === "cancelled") return null;
  const from = labDayOf(order.receivedAt);
  const to = labDayOf(order.shippedAt);
  return to <= from ? 0 : businessDaysBetween(from, to, calendar ?? DEFAULT_CALENDAR);
}

/** Shipped (not cancelled) on a lab day in the range: the orders a turnaround figure averages. */
export const shippedInSql = (range) => sql`${labOrders.status} = 'shipped' and ${labOrders.shippedAt} is not null and ${labDayBetween(labOrders.shippedAt, range)}`;

const avgOrNull = (v) => (v == null ? null : Number(v));

/** Average turnaround (turnaroundDaysSql) of orders shipped in the range: { orders, avgDays | null }. */
export async function turnaroundAverage(db, range, calendar = null) {
  const cal = calendar ?? (await labCalendar(db));
  const [r = {}] = await rowsOf(db, sql`
    select count(*) as "orders", avg(${turnaroundDaysSql(cal)}) as "avgDays" from ${labOrders} where ${shippedInSql(range)}`);
  return { orders: num(r.orders), avgDays: avgOrNull(r.avgDays) };
}

/** The Monday of a "YYYY-MM-DD" day's week (Postgres date_trunc('week') weeks). */
export function weekStart(day) {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

/** Average turnaround per week shipped (Monday start), every week the range touches: [{ week, orders, avgDays | null }]. */
export async function turnaroundByWeek(db, range, calendar = null) {
  const cal = calendar ?? (await labCalendar(db));
  const raw = await rowsOf(db, sql`
    select to_char(date_trunc('week', ${labDay(labOrders.shippedAt)}), 'YYYY-MM-DD') as "week", count(*) as "orders", avg(${turnaroundDaysSql(cal)}) as "avgDays"
    from ${labOrders} where ${shippedInSql(range)}
    group by 1 order by 1`);
  const byWeek = new Map(raw.map((r) => [String(r.week), r]));
  const weeks = [];
  for (let w = weekStart(range.from); w <= range.to; w = addDays(w, 7)) weeks.push(w);
  return weeks.map((week) => ({ week, orders: num(byWeek.get(week)?.orders), avgDays: avgOrNull(byWeek.get(week)?.avgDays) }));
}

// ── Board day counts (piece 7's board) ───────────────────────────────────

/**
 * { pastDue, dueToday, dueTomorrow, onHold, atRisk } as of `now` (a Date):
 * piece 7's boardTiles over the report's transaction, so a dashboard tile and
 * the production board never disagree.
 */
export async function boardDayCounts(db, now = new Date()) {
  const { pastDue, dueToday, dueTomorrow, onHold, atRisk } = await boardTiles(db, now);
  return { pastDue, dueToday, dueTomorrow, onHold, atRisk };
}

/** How many at-risk orders the list shows. */
export const AT_RISK_LIST_LIMIT = 50;

/**
 * The at-risk orders as of `now` (piece 7's tileOrderIds(db, "at_risk")), soonest
 * due first, at most `limit`: { rows: [{ id, orderNumber, client, status, dueDate, rush }],
 * total, truncated }. `total` counts the same ids the At risk tile counts. The ids are
 * bound as ONE array parameter, so the statement stays one bind however many are at risk.
 */
export async function atRiskOrders(db, now = new Date(), limit = AT_RISK_LIST_LIMIT) {
  const ids = (await tileOrderIds(db, "at_risk", now)) ?? [];
  if (!ids.length) return { rows: [], total: 0, truncated: false };
  const raw = await rowsOf(db, sql`
    select ${labOrders.id} as "id", ${labOrders.orderNumber} as "orderNumber", ${clientName} as "client",
      ${labOrders.status} as "status", to_char(${labOrders.dueDate}, 'YYYY-MM-DD') as "dueDate", ${labOrders.rush} as "rush"
    from ${labOrders}
    ${optionalClientJoin(labOrders.clientUserId)}
    where ${labOrders.id} = any(${sql.param(ids)}::text[])
    order by ${labOrders.dueDate} nulls last, ${labOrders.rush} desc, ${labOrders.orderNumber}
    limit ${limit}`);
  const rows = raw.map((r) => ({
    id: r.id, orderNumber: r.orderNumber, client: r.client ?? null, status: r.status, dueDate: r.dueDate ?? null, rush: Boolean(r.rush),
  }));
  return { rows, total: ids.length, truncated: ids.length > limit };
}

// ── Per-day series ───────────────────────────────────────────────────────

/** Open orders due per day, every day in the range: [{ day, orders, rush }]. boardDayCounts' due-today rule, by day. */
export async function dueByDay(db, range) {
  const raw = await rowsOf(db, sql`
    select to_char(${labOrders.dueDate}, 'YYYY-MM-DD') as "day", count(*) as "orders", count(*) filter (where ${labOrders.rush}) as "rush"
    from ${labOrders}
    where ${isOpenOrder} and ${labOrders.dueDate} between ${range.from}::date and ${range.to}::date
    group by 1 order by 1`);
  const byDay = new Map(raw.map((r) => [String(r.day), r]));
  return daysInRange(range.from, range.to).map((day) => ({ day, orders: num(byDay.get(day)?.orders), rush: num(byDay.get(day)?.rush) }));
}

/**
 * Orders received per lab day, every day in the range: [{ day, orders, rush, remakes, units }]. Cancelled orders do not count.
 * `scope` (optional, here and in shippedByDay) is report-helpers practiceScope(params): a practice/group filter.
 */
export async function ordersByDay(db, range, scope = null) {
  const raw = await rowsOf(db, sql`
    select ${labDayText(labOrders.receivedAt)} as "day", count(*) as "orders",
      count(*) filter (where ${labOrders.rush}) as "rush", count(*) filter (where ${labOrders.isRemake}) as "remakes",
      coalesce(sum(u.units), 0) as "units"
    from ${labOrders} ${unitsJoin}
    where ${isLiveOrder} and ${labDayBetween(labOrders.receivedAt, range)}${andScope(scope)}
    group by 1 order by 1`);
  const byDay = new Map(raw.map((r) => [String(r.day), r]));
  return daysInRange(range.from, range.to).map((day) => {
    const r = byDay.get(day) ?? {};
    return { day, orders: num(r.orders), rush: num(r.rush), remakes: num(r.remakes), units: num(r.units) };
  });
}

/**
 * Orders shipped per lab day (lab_orders.shipped_at), every day in the range,
 * with the shipments that carried them by carrier: [{ day, orders, shipments,
 * ups, fedex, manual, noShipment }]. A shipment carrying several orders counts
 * once; an order shipped with no shipment record (imported history) counts
 * under noShipment.
 */
export async function shippedByDay(db, range, scope = null) {
  const perCarrier = CARRIERS.map((c) => sql`count(distinct ${shipments.id}) filter (where ${shipments.carrier} = ${c}) as ${sql.identifier(c)}`);
  const raw = await rowsOf(db, sql`
    select ${labDayText(labOrders.shippedAt)} as "day", count(*) as "orders", count(distinct ${shipments.id}) as "shipments",
      ${sql.join(perCarrier, sql`, `)}, count(*) filter (where ${shipments.id} is null) as "noShipment"
    from ${labOrders}
    left join ${shipments} on ${shipments.id} = ${labOrders.shipmentId}
    where ${labOrders.status} = 'shipped' and ${labDayBetween(labOrders.shippedAt, range)}${andScope(scope)}
    group by 1 order by 1`);
  const byDay = new Map(raw.map((r) => [String(r.day), r]));
  return daysInRange(range.from, range.to).map((day) => {
    const r = byDay.get(day) ?? {};
    const carriers = Object.fromEntries(CARRIERS.map((c) => [c, num(r[c])]));
    return { day, orders: num(r.orders), shipments: num(r.shipments), ...carriers, noShipment: num(r.noShipment) };
  });
}

/** Units on open orders per catalog category: [{ category, units, orders }], most units first. */
export async function openUnitsByCategory(db) {
  const raw = await rowsOf(db, sql`
    select coalesce(${productFamilies.category}, ${uncategorizedSql}) as "category",
      sum(${labOrderLines.qty}) as "units", count(distinct ${labOrders.id}) as "orders"
    from ${labOrderLines}
    join ${labOrders} on ${labOrders.id} = ${labOrderLines.labOrderId}
    ${catalogJoins(labOrderLines)}
    where ${labOrderLines.noteOnly} = false and ${isOpenOrder}
    group by 1 order by 2 desc, 1`);
  return raw.map((r) => ({ category: r.category, units: num(r.units), orders: num(r.orders) }));
}
