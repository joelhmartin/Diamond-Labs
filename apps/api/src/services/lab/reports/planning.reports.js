/**
 * Planning (7). Staff. Work is planned per assignee (lab_orders.assignee_user_id);
 * orders nobody is assigned to are their own "Unassigned" row. Three run now;
 * Calendar needs piece 7's business calendar (capacityFor), and the task
 * reports need its workflow stage targets.
 */
import { sql } from "drizzle-orm";
import { labOrders } from "../../../db/schema/index.js";
import { ORDER_LINK, clientName, isLiveOrder, labDayBetween, labDayText, labToday, num, rowsOf } from "./lab-metrics.js";
import {
  AT_RISK_DAYS, assigneeJoin, assigneeName, dueSoonSql, isOnHold, isOpenOrder, orderJoins, pastDueSql, statusBadge, unitsJoin,
} from "./order-metrics.js";
import { dependentReport } from "./dependent.js";

const GROUP = "planning";
const RANGE = { name: "range", label: "Dates", type: "dateRange", default: "last30", maxDays: 1100 };
const STAFF = { name: "assignee", label: "Assigned to", type: "lookup", source: "staff" };
const ASSIGNEE_COL = { id: "assignee", label: "Assigned to", type: "text" };
const ORDER_COL = { id: "orderNumber", label: "Order #", type: "text", link: ORDER_LINK };
const int = (id, label) => ({ id, label, type: "int" });
const sumOf = (rows, k) => rows.reduce((s, r) => s + (r[k] ?? 0), 0);
const sums = (rows, ids) => Object.fromEntries(ids.map((id) => [id, sumOf(rows, id)]));
/** Per assignee, named people first (by name), Unassigned last. */
const byAssignee = sql`group by ${labOrders.assigneeUserId}, assignee.name order by (${labOrders.assigneeUserId} is null), 2`;

// ── Technician Workload ──────────────────────────────────────────────────

const workload = {
  key: "planning.technician-workload", group: GROUP, featured: true, title: "Technician Workload",
  description: `Open orders and units per person they are assigned to, with past due, due in the next ${AT_RISK_DAYS} days, on hold and rush. Unassigned orders are their own row.`,
  params: [],
  columns: [
    ASSIGNEE_COL, int("orders", "Open orders"), int("units", "Units"), int("pastDue", "Past due"),
    int("dueSoon", `Due in ${AT_RISK_DAYS} days`), int("onHold", "On hold"), int("rush", "Rush"),
  ],
  chart: { type: "bar", x: "assignee", series: [{ field: "orders", label: "Open orders" }, { field: "units", label: "Units" }] },
  async run(tx, _params, _actor, ctx) {
    const today = labToday(ctx);
    const raw = await rowsOf(tx, sql`
      select ${labOrders.assigneeUserId} as "assigneeUserId", ${assigneeName} as "assignee", count(*) as "orders",
        coalesce(sum(u.units), 0) as "units", count(*) filter (where ${pastDueSql(today)}) as "pastDue",
        count(*) filter (where ${dueSoonSql(today)}) as "dueSoon",
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

// ── Dependent (Task 10 fills these in) ───────────────────────────────────

const AHEAD = { name: "days", label: "Days ahead", type: "number", default: 14, min: 1, max: 90 };
const TASK_COLS = [
  ASSIGNEE_COL, ORDER_COL, { id: "stage", label: "Stage", type: "text" }, { id: "department", label: "Department", type: "text" },
  { id: "target", label: "Stage target", type: "date" }, { id: "status", label: "Status", type: "badge" },
];

const dependents = [
  dependentReport({
    key: "planning.calendar", group: GROUP, featured: true, title: "Calendar", requires: ["business-calendar"],
    description: "Orders and units due each day against the lab's capacity for that day, from the business calendar.",
    params: [AHEAD],
    columns: [
      { id: "day", label: "Day", type: "date" }, int("orders", "Orders due"), int("units", "Units due"),
      int("capacity", "Capacity"), { id: "load", label: "Load", type: "pct" },
    ],
    chart: { type: "bar", x: "day", series: [{ field: "units", label: "Units due" }, { field: "capacity", label: "Capacity" }] },
  }),
  dependentReport({
    key: "planning.tasks-schedule", group: GROUP, featured: true, title: "Tasks Schedule", requires: ["workflows"],
    description: "Workflow stage targets per day for the days ahead, by stage and department.",
    params: [AHEAD],
    columns: [
      { id: "day", label: "Day", type: "date" }, { id: "stage", label: "Stage", type: "text" },
      { id: "department", label: "Department", type: "text" }, int("targets", "Targets"), int("behind", "Behind"),
    ],
  }),
  dependentReport({
    key: "planning.assigned-tasks", group: GROUP, title: "Assigned Tasks", requires: ["workflows"],
    description: "Workflow stage targets of the orders assigned to each person.",
    params: [RANGE, STAFF],
    columns: TASK_COLS,
  }),
  dependentReport({
    key: "planning.assigned-tasks-summary", group: GROUP, title: "Assigned Tasks Summary", requires: ["workflows"],
    description: "Workflow stage targets per person, counted: due, done and behind.",
    params: [RANGE],
    columns: [ASSIGNEE_COL, int("due", "Due"), int("done", "Done"), int("behind", "Behind")],
  }),
];

export const PLANNING_REPORTS = [workload, assignedOrders, assignedUnits, ...dependents];

export function registerPlanningReports(registry) {
  for (const def of PLANNING_REPORTS) registry.defineReport(def);
}
