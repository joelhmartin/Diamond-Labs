/**
 * Planning (7). Staff. Work is planned per assignee (lab_orders.assignee_user_id);
 * orders nobody is assigned to are their own "Unassigned" row. Calendar is
 * due work against piece 7's business calendar (calendarDays / capacityFor,
 * the same per-day counts as the Calendar page: labLoadCounts); the task
 * reports read piece 7's saved workflow stage targets (stage-targets.js).
 */
import { sql } from "drizzle-orm";
import { labOrders } from "../../../db/schema/index.js";
import { addBusinessDays, calendarDays, nextOpenDay } from "../../../modules/business-calendar/index.js";
import { labLoadCounts } from "../lab-schedule-queries.js";
import { AT_RISK_BUSINESS_DAYS } from "../lab-schedule-flags.js";
import { addDays } from "@my-app/shared";
import {
  ORDER_LINK, clientName, isLiveOrder, labCalendar, labDayBetween, labDayText, labToday, num, rowsOf,
} from "./lab-metrics.js";
import {
  assigneeJoin, assigneeName, dueSoonSql, isOnHold, isOpenOrder, orderJoins, pastDueSql, statusBadge, unitsJoin,
} from "./order-metrics.js";
import { STAGE_STATES, byName, countTargets, plannedOrders, stageTargets, taskRow } from "./stage-targets.js";
import { int, sumOf, sums } from "./report-helpers.js";

const GROUP = "planning";
const RANGE = { name: "range", label: "Dates", type: "dateRange", default: "last30", maxDays: 1100 };
const STAFF = { name: "assignee", label: "Assigned to", type: "lookup", source: "staff" };
const ASSIGNEE_COL = { id: "assignee", label: "Assigned to", type: "text" };
const ORDER_COL = { id: "orderNumber", label: "Order #", type: "text", link: ORDER_LINK };
/** Per assignee, named people first (by name), Unassigned last. */
const byAssignee = sql`group by ${labOrders.assigneeUserId}, assignee.name order by (${labOrders.assigneeUserId} is null), 2`;

// ── Technician Workload ──────────────────────────────────────────────────

const workload = {
  key: "planning.technician-workload", group: GROUP, featured: true, title: "Technician Workload",
  description: `Open orders and units per person they are assigned to, with past due, due within ${AT_RISK_BUSINESS_DAYS} business days (the board's at-risk window), on hold and rush. Unassigned orders are their own row.`,
  params: [],
  columns: [
    ASSIGNEE_COL, int("orders", "Open orders"), int("units", "Units"), int("pastDue", "Past due"),
    int("dueSoon", `Due in ${AT_RISK_BUSINESS_DAYS} business days`), int("onHold", "On hold"), int("rush", "Rush"),
  ],
  chart: { type: "bar", x: "assignee", series: [{ field: "orders", label: "Open orders" }, { field: "units", label: "Units" }] },
  async run(tx, _params, _actor, ctx) {
    const today = labToday(ctx);
    const calendar = await labCalendar(tx);
    const raw = await rowsOf(tx, sql`
      select ${labOrders.assigneeUserId} as "assigneeUserId", ${assigneeName} as "assignee", count(*) as "orders",
        coalesce(sum(u.units), 0) as "units", count(*) filter (where ${pastDueSql(today)}) as "pastDue",
        count(*) filter (where ${dueSoonSql(today, calendar)}) as "dueSoon",
        count(*) filter (where ${isOnHold}) as "onHold", count(*) filter (where ${labOrders.rush}) as "rush"
      from ${labOrders} ${assigneeJoin} ${unitsJoin}
      where ${isOpenOrder}
      ${byAssignee}`);
    const ids = ["orders", "units", "pastDue", "dueSoon", "onHold", "rush"];
    const rows = raw.map((r) => ({ assigneeUserId: r.assigneeUserId ?? null, assignee: r.assignee, ...Object.fromEntries(ids.map((k) => [k, num(r[k])])) }));
    return { rows, summary: { assignee: "Total", ...sums(rows, ids) } };
  },
};

// ── Assigned Orders / Assigned Units Chart ───────────────────────────────

const assignedOrders = {
  key: "planning.assigned-orders", group: GROUP, title: "Assigned Orders",
  description: "Orders received in the range, listed by the person they are assigned to (cancelled orders are not listed).",
  params: [RANGE, STAFF],
  columns: [
    ASSIGNEE_COL, ORDER_COL, { id: "client", label: "Client", type: "text" }, { id: "status", label: "Status", type: "badge" },
    { id: "received", label: "Received", type: "date" }, { id: "dueDate", label: "Due", type: "date" }, int("units", "Units"),
  ],
  async run(tx, { range, assignee }) {
    const who = assignee ? sql` and ${labOrders.assigneeUserId} = ${assignee}` : sql``;
    const raw = await rowsOf(tx, sql`
      select ${assigneeName} as "assignee", ${labOrders.id} as "labOrderId", ${labOrders.orderNumber} as "orderNumber",
        ${clientName} as "client", ${labOrders.status} as "status", ${labDayText(labOrders.receivedAt)} as "receivedDay",
        to_char(${labOrders.dueDate}, 'YYYY-MM-DD') as "dueDate", u.units as "units"
      from ${labOrders} ${orderJoins} ${unitsJoin}
      where ${isLiveOrder} and ${labDayBetween(labOrders.receivedAt, range)}${who}
      order by (${labOrders.assigneeUserId} is null), 1, ${labOrders.receivedAt}, ${labOrders.id}`);
    const rows = raw.map((r) => ({
      assignee: r.assignee, labOrderId: r.labOrderId, orderNumber: r.orderNumber, client: r.client ?? null, status: statusBadge(r.status),
      received: r.receivedDay, dueDate: r.dueDate ?? null, units: num(r.units),
    }));
    return { rows, summary: { assignee: "Total", units: sumOf(rows, "units") } };
  },
};

const assignedUnits = {
  key: "planning.assigned-units-chart", group: GROUP, title: "Assigned Units Chart",
  description: "Product units on orders received in the range, per person they are assigned to.",
  params: [RANGE],
  columns: [ASSIGNEE_COL, int("units", "Units"), int("orders", "Orders")],
  chart: { type: "bar", x: "assignee", series: [{ field: "units", label: "Units" }] },
  async run(tx, { range }) {
    const raw = await rowsOf(tx, sql`
      select ${labOrders.assigneeUserId} as "assigneeUserId", ${assigneeName} as "assignee",
        coalesce(sum(u.units), 0) as "units", count(*) as "orders"
      from ${labOrders} ${assigneeJoin} ${unitsJoin}
      where ${isLiveOrder} and ${labDayBetween(labOrders.receivedAt, range)}
      ${byAssignee}`);
    const rows = raw.map((r) => ({ assigneeUserId: r.assigneeUserId ?? null, assignee: r.assignee, units: num(r.units), orders: num(r.orders) }));
    return { rows, summary: { assignee: "Total", ...sums(rows, ["units", "orders"]) } };
  },
};

// ── Calendar / Tasks Schedule (piece 7) ──────────────────────────────────

const AHEAD = { name: "days", label: "Days ahead", type: "number", default: 14, min: 1, max: 90 };
const STATE_COL = { id: "state", label: "Stage", type: "badge" };
const TASK_COLS = [
  ASSIGNEE_COL, ORDER_COL, { id: "stage", label: "Stage", type: "text" }, { id: "department", label: "Department", type: "text" },
  { id: "target", label: "Stage target", type: "date" }, { ...STATE_COL, label: "Done?" }, { id: "status", label: "Order status", type: "badge" },
];
const COUNT_COLS = [int("due", "Due"), int("done", "Done"), int("behind", "Behind")];
const daysParam = (params) => (Number.isInteger(params?.days) ? params.days : AHEAD.default);

const calendar = {
  key: "planning.calendar", group: GROUP, featured: true, title: "Calendar", requires: ["business-calendar"],
  description: "Orders and units due each day against the lab's capacity for that day (the business calendar: closed days have none). Load is the calendar's count (orders or units) over its capacity. Cancelled orders are not counted.",
  params: [AHEAD],
  columns: [
    { id: "day", label: "Day", type: "date", link: "/lab/calendar?view=week&anchor={day}" }, int("orders", "Orders due"), int("units", "Units due"),
    int("capacity", "Capacity"), { id: "load", label: "Load", type: "pct" }, { id: "note", label: "Note", type: "text" },
  ],
  chart: { type: "bar", x: "day", series: [{ field: "units", label: "Units due" }, { field: "capacity", label: "Capacity" }] },
  async run(tx, params, _actor, ctx) {
    const from = labToday(ctx);
    const to = addDays(from, daysParam(params) - 1);
    const cal = await labCalendar(tx);
    const orders = await labLoadCounts(tx, { from, to, basis: "orders" });
    const units = await labLoadCounts(tx, { from, to, basis: "units" });
    const basis = cal.capacityBasis === "units" ? units : orders;
    const rows = calendarDays(cal, from, to, basis).map((d) => ({
      day: d.date, orders: orders.get(d.date) ?? 0, units: units.get(d.date) ?? 0, capacity: d.capacity,
      load: d.capacity ? d.count / d.capacity : null, note: d.holiday ?? (d.open ? "" : "Closed"),
    }));
    const notice = cal.capacityBasis === "none"
      ? "No daily capacity is set on the lab calendar, so load is not shown."
      : `Capacity counts ${cal.capacityBasis === "units" ? "units" : "orders"} (set on the lab calendar).`;
    return { rows, summary: { day: "Total", orders: sumOf(rows, "orders"), units: sumOf(rows, "units") }, notice };
  },
};

/** The next `n` open days from `today` (today itself when open), by the business calendar. */
function openDaysAhead(today, n, cal) {
  try {
    const days = [nextOpenDay(today, cal)];
    while (days.length < n) days.push(addBusinessDays(days[days.length - 1], 1, cal));
    return days;
  } catch {
    return []; // a calendar with no open day plans nothing
  }
}

const tasksSchedule = {
  key: "planning.tasks-schedule", group: GROUP, featured: true, title: "Tasks Schedule", requires: ["workflows"],
  description: "Workflow stage targets still to do on each of the next lab (open) days, by stage and department. Behind counts targets whose order is already behind its plan.",
  params: [{ ...AHEAD, label: "Lab days ahead" }],
  columns: [
    { id: "day", label: "Day", type: "date" }, { id: "stage", label: "Stage", type: "text" },
    { id: "department", label: "Department", type: "text" }, int("targets", "Targets"), int("behind", "Behind"),
  ],
  async run(tx, params, _actor, ctx) {
    const today = labToday(ctx);
    const cal = await labCalendar(tx);
    const days = openDaysAhead(today, daysParam(params), cal);
    if (!days.length) return { rows: [], notice: "The lab calendar has no open days." };
    const range = { from: today, to: days[days.length - 1] };
    const targets = stageTargets(await plannedOrders(tx, { range, openOnly: true }), today, cal, range).filter((t) => !t.reached);
    const groups = new Map();
    for (const t of targets) {
      const k = `${t.target}|${t.stage}|${t.department}`;
      let g = groups.get(k);
      if (!g) groups.set(k, (g = { day: t.target, stage: t.stage, position: t.position, department: t.department, departmentId: t.departmentId, targets: 0, behind: 0 }));
      g.targets += 1;
      if (t.behind) g.behind += 1;
    }
    const rows = [...groups.values()]
      .sort((a, b) => a.day.localeCompare(b.day) || a.position - b.position || a.stage.localeCompare(b.stage) || byName("department", "departmentId")(a, b))
      .map(({ position, departmentId, ...r }) => r);
    return { rows, summary: { day: "Total", ...sums(rows, ["targets", "behind"]) }, notice: `Lab days ${range.from} to ${range.to}.` };
  },
};

// ── Assigned Tasks / Assigned Tasks Summary (piece 7) ────────────────────

const RANGE_TASKS = { ...RANGE, default: "last7" };

const assignedTasks = {
  key: "planning.assigned-tasks", group: GROUP, title: "Assigned Tasks", requires: ["workflows"],
  description: `Workflow stage targets in the range of the orders assigned to each person: ${Object.values(STAGE_STATES).join(", ").toLowerCase()}.`,
  params: [RANGE_TASKS, STAFF],
  columns: TASK_COLS,
  async run(tx, { range, assignee }, _actor, ctx) {
    const today = labToday(ctx);
    const targets = stageTargets(await plannedOrders(tx, { range, assignee }), today, await labCalendar(tx), range);
    const rows = targets
      .sort((a, b) => byName("assignee", "assigneeUserId")(a, b) || a.target.localeCompare(b.target) || a.orderNumber - b.orderNumber || a.position - b.position)
      .map(taskRow);
    return { rows };
  },
};

const assignedTasksSummary = {
  key: "planning.assigned-tasks-summary", group: GROUP, title: "Assigned Tasks Summary", requires: ["workflows"],
  description: "Workflow stage targets in the range per person their orders are assigned to: due, done and behind.",
  params: [RANGE_TASKS],
  columns: [ASSIGNEE_COL, ...COUNT_COLS],
  async run(tx, { range }, _actor, ctx) {
    const targets = stageTargets(await plannedOrders(tx, { range }), labToday(ctx), await labCalendar(tx), range);
    const rows = countTargets(targets, (t) => t.assigneeUserId ?? "", (t) => ({ assigneeUserId: t.assigneeUserId, assignee: t.assignee }))
      .sort(byName("assignee", "assigneeUserId"));
    return { rows, summary: { assignee: "Total", ...sums(rows, ["due", "done", "behind"]) } };
  },
};

export const PLANNING_REPORTS = [workload, assignedOrders, assignedUnits, calendar, tasksSchedule, assignedTasks, assignedTasksSummary];

export function registerPlanningReports(registry) {
  for (const def of PLANNING_REPORTS) registry.defineReport(def);
}
