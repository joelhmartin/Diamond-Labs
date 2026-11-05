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
 * - At risk     = interim rule until piece 7's board tiles (Task 10 re-points
 *                 `boardDayCounts` there): open, not on hold, still received or
 *                 in production, and due today through today + 2 inclusive, so
 *                 never already past due (a late order is past due, not at
 *                 risk). The same window as Technician Workload's "due soon".
 * - Turnaround  = calendar days received → shipped (lab-metrics turnaroundDaysSql).
 *
 * "today" is always the lab-local day the caller passes (the runner's ctx.today).
 */
import { sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  CARRIERS, LAB_STATUS_LABELS, LAB_TIMEZONE, TERMINAL_LAB_STATUSES, addDays, daysBetween, isoDateIn,
} from "@my-app/shared";
import { labOrders, labOrderLines, labDepartments, users, shipments, productFamilies } from "../../../db/schema/index.js";
import { catalogJoins, clientName, isLiveOrder, labDay, labDayBetween, labDayText, num, rowsOf, turnaroundDaysSql } from "./lab-metrics.js";
import { optionalClientJoin, uncategorizedSql } from "./report-helpers.js";

// ── SQL building blocks ──────────────────────────────────────────────────

/** A literal SQL list of fixed status words ('a', 'b'): readable in the plan, never user input. */
const literalList = (words) => {
  if (!words.every((w) => /^[a-z_]+$/.test(w))) throw new Error("status words only");
  return sql.raw(words.map((w) => `'${w}'`).join(", "));
};

/** The statuses at-risk applies to (interim rule). */
export const AT_RISK_STATUSES = Object.freeze(["received", "in_production"]);
/** At risk = due within this many calendar days of today (interim rule). */
export const AT_RISK_DAYS = 2;

/** Open: not shipped and not cancelled (isTerminalLabStatus). */
export const isOpenOrder = sql`${labOrders.status} not in (${literalList(TERMINAL_LAB_STATUSES)})`;
export const isOnHold = sql`${labOrders.status} = 'on_hold'`;
/** isOverdue(dueDate, status, today) in SQL. */
export const pastDueSql = (today) => sql`${isOpenOrder} and ${labOrders.dueDate} < ${today}::date`;
/** Open and due on `day`. */
export const dueOnSql = (day) => sql`${isOpenOrder} and ${labOrders.dueDate} = ${day}::date`;
/** Due today through today + AT_RISK_DAYS inclusive (at risk's window; Technician Workload's "due soon"). */
export const dueSoonSql = (today) => sql`${labOrders.dueDate} between ${today}::date and ${addDays(today, AT_RISK_DAYS)}::date`;
/** The interim at-risk rule (see header). */
export const atRiskSql = (today) => sql`${labOrders.status} in (${literalList(AT_RISK_STATUSES)}) and ${dueSoonSql(today)}`;

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

/** A lab status as a badge cell. */
export const statusBadge = (s) => (s ? { value: s, label: LAB_STATUS_LABELS[s] ?? s } : null);

// ── Turnaround ───────────────────────────────────────────────────────────

const labDayOf = (v) => (v == null ? null : isoDateIn(LAB_TIMEZONE, new Date(v)));

/**
 * Turnaround of one order in days, received → shipped, between lab-local days;
 * null when it has not shipped or was cancelled. The JS twin of
 * lab-metrics `turnaroundDaysSql` (reports average that in SQL).
 * `calendar`: business days arrive with piece 7 (Task 10, addBusinessDays/isOpen).
 */
export function turnaroundDays(order, calendar) {
  if (calendar !== undefined) throw new Error("Business-day turnaround needs the business calendar (piece 7)");
  if (!order?.shippedAt || !order.receivedAt || order.status === "cancelled") return null;
  const from = labDayOf(order.receivedAt);
  const to = labDayOf(order.shippedAt);
  return to < from ? 0 : daysBetween(from, to).length - 1;
}

/** Shipped (not cancelled) on a lab day in the range: the orders a turnaround figure averages. */
export const shippedInSql = (range) => sql`${labOrders.status} = 'shipped' and ${labOrders.shippedAt} is not null and ${labDayBetween(labOrders.shippedAt, range)}`;

const avgOrNull = (v) => (v == null ? null : Number(v));

/** Average turnaround (turnaroundDaysSql) of orders shipped in the range: { orders, avgDays | null }. */
export async function turnaroundAverage(db, range) {
  const [r = {}] = await rowsOf(db, sql`
    select count(*) as "orders", avg(${turnaroundDaysSql}) as "avgDays" from ${labOrders} where ${shippedInSql(range)}`);
  return { orders: num(r.orders), avgDays: avgOrNull(r.avgDays) };
}

/** The Monday of a "YYYY-MM-DD" day's week (Postgres date_trunc('week') weeks). */
export function weekStart(day) {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

/** Average turnaround per week shipped (Monday start), every week the range touches: [{ week, orders, avgDays | null }]. */
export async function turnaroundByWeek(db, range) {
  const raw = await rowsOf(db, sql`
    select to_char(date_trunc('week', ${labDay(labOrders.shippedAt)}), 'YYYY-MM-DD') as "week", count(*) as "orders", avg(${turnaroundDaysSql}) as "avgDays"
    from ${labOrders} where ${shippedInSql(range)}
    group by 1 order by 1`);
  const byWeek = new Map(raw.map((r) => [String(r.week), r]));
  const weeks = [];
  for (let w = weekStart(range.from); w <= range.to; w = addDays(w, 7)) weeks.push(w);
  return weeks.map((week) => ({ week, orders: num(byWeek.get(week)?.orders), avgDays: avgOrNull(byWeek.get(week)?.avgDays) }));
}

// ── Board day counts (the seam piece 7 replaces) ─────────────────────────

/**
 * { pastDue, dueToday, dueTomorrow, onHold, atRisk } for the lab day `today`,
 * one query over open orders. Task 10 re-points this at piece 7's board tiles.
 */
export async function boardDayCounts(db, today) {
  const [r = {}] = await rowsOf(db, sql`
    select
      count(*) filter (where ${pastDueSql(today)}) as "pastDue",
      count(*) filter (where ${labOrders.dueDate} = ${today}::date) as "dueToday",
      count(*) filter (where ${labOrders.dueDate} = ${addDays(today, 1)}::date) as "dueTomorrow",
      count(*) filter (where ${isOnHold}) as "onHold",
      count(*) filter (where ${atRiskSql(today)}) as "atRisk"
    from ${labOrders}
    where ${isOpenOrder}`);
  return { pastDue: num(r.pastDue), dueToday: num(r.dueToday), dueTomorrow: num(r.dueTomorrow), onHold: num(r.onHold), atRisk: num(r.atRisk) };
}

/** How many at-risk orders the list shows. */
export const AT_RISK_LIST_LIMIT = 50;

/**
 * The at-risk orders, soonest due first, at most `limit`:
 * { rows: [{ id, orderNumber, client, status, dueDate, rush }], truncated }.
 * One row past the limit is read so `truncated` says whether more exist.
 */
export async function atRiskOrders(db, today, limit = AT_RISK_LIST_LIMIT) {
  const raw = await rowsOf(db, sql`
    select ${labOrders.id} as "id", ${labOrders.orderNumber} as "orderNumber", ${clientName} as "client",
      ${labOrders.status} as "status", to_char(${labOrders.dueDate}, 'YYYY-MM-DD') as "dueDate", ${labOrders.rush} as "rush"
    from ${labOrders}
    ${optionalClientJoin(labOrders.clientUserId)}
    where ${isOpenOrder} and ${atRiskSql(today)}
    order by ${labOrders.dueDate}, ${labOrders.rush} desc, ${labOrders.orderNumber}
    limit ${limit + 1}`);
  const rows = raw.slice(0, limit).map((r) => ({
    id: r.id, orderNumber: r.orderNumber, client: r.client ?? null, status: r.status, dueDate: r.dueDate ?? null, rush: Boolean(r.rush),
  }));
  return { rows, truncated: raw.length > limit };
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
  return daysBetween(range.from, range.to).map((day) => ({ day, orders: num(byDay.get(day)?.orders), rush: num(byDay.get(day)?.rush) }));
}

/** Orders received per lab day, every day in the range: [{ day, orders, rush, remakes, units }]. Cancelled orders do not count. */
export async function ordersByDay(db, range) {
  const raw = await rowsOf(db, sql`
    select ${labDayText(labOrders.receivedAt)} as "day", count(*) as "orders",
      count(*) filter (where ${labOrders.rush}) as "rush", count(*) filter (where ${labOrders.isRemake}) as "remakes",
      coalesce(sum(u.units), 0) as "units"
    from ${labOrders} ${unitsJoin}
    where ${isLiveOrder} and ${labDayBetween(labOrders.receivedAt, range)}
    group by 1 order by 1`);
  const byDay = new Map(raw.map((r) => [String(r.day), r]));
  return daysBetween(range.from, range.to).map((day) => {
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
export async function shippedByDay(db, range) {
  const perCarrier = CARRIERS.map((c) => sql`count(distinct ${shipments.id}) filter (where ${shipments.carrier} = ${c}) as ${sql.identifier(c)}`);
  const raw = await rowsOf(db, sql`
    select ${labDayText(labOrders.shippedAt)} as "day", count(*) as "orders", count(distinct ${shipments.id}) as "shipments",
      ${sql.join(perCarrier, sql`, `)}, count(*) filter (where ${shipments.id} is null) as "noShipment"
    from ${labOrders}
    left join ${shipments} on ${shipments.id} = ${labOrders.shipmentId}
    where ${labOrders.status} = 'shipped' and ${labDayBetween(labOrders.shippedAt, range)}
    group by 1 order by 1`);
  const byDay = new Map(raw.map((r) => [String(r.day), r]));
  return daysBetween(range.from, range.to).map((day) => {
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
