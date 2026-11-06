/**
 * Departments (8). Staff. Departments are the lab's own rooms/benches
 * (lab_departments); an order with none is its own "No department" row. Dept
 * Tasks and Dept Tasks Summary read piece 7's workflow stage targets
 * (stage-targets.js), by the order's department.
 * Department moves are lab_order_events of type department (from/to hold
 * department ids); the event note is never read.
 */
import { sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { LAB_ORDER_STATUSES, LAB_STATUS_LABELS, LAB_TIMEZONE, TERMINAL_LAB_STATUSES } from "@my-app/shared";
import { labOrders, labOrderEvents, labOrderLines, labDepartments, users, productFamilies } from "../../../db/schema/index.js";
import {
  ORDER_LINK, catalogJoins, clientName, isLiveOrder, labCalendar, labDayBetween, labDayText, labToday, num, rowsOf,
} from "./lab-metrics.js";
import {
  NO_DEPARTMENT, assigneeName, byDepartment, departmentJoin, departmentName, departmentOrder, isOnHold, isOpenOrder, orderJoins,
  pastDueSql, statusBadge, unitsJoin,
} from "./order-metrics.js";
import { byName, countTargets, plannedOrders, stageTargets, taskRow } from "./stage-targets.js";
import { int, sumOf, sums, uncategorizedSql } from "./report-helpers.js";

const GROUP = "departments";
const RANGE = { name: "range", label: "Dates", type: "dateRange", default: "last30", maxDays: 1100 };
const DEPARTMENT = { name: "department", label: "Department", type: "lookup", source: "department" };
const DEPT_COL = { id: "department", label: "Department", type: "text" };
/** The statuses an open order can be in, in board order. */
const OPEN_STATUSES = LAB_ORDER_STATUSES.filter((s) => !TERMINAL_LAB_STATUSES.includes(s));

// ── Monitoring Boards (wall) ─────────────────────────────────────────────

const monitoringBoards = {
  key: "departments.monitoring-boards", group: GROUP, featured: true, display: "wall", title: "Monitoring Boards",
  description: "Open orders in each department by status, with how many are past due. Wall view shows it full screen and refreshes every minute.",
  params: [],
  columns: [
    DEPT_COL, ...OPEN_STATUSES.map((s) => int(s, LAB_STATUS_LABELS[s] ?? s)), int("total", "Open"), int("pastDue", "Past due"),
  ],
  chart: { type: "stackedBar", x: "department", series: OPEN_STATUSES.map((s) => ({ field: s, label: LAB_STATUS_LABELS[s] ?? s })) },
  async run(tx, _params, _actor, ctx) {
    const raw = await rowsOf(tx, sql`
      select ${labOrders.departmentId} as "departmentId", ${departmentName} as "department", ${labOrders.status} as "status",
        count(*) as "orders", count(*) filter (where ${pastDueSql(labToday(ctx))}) as "pastDue"
      from ${labOrders} ${departmentJoin}
      where ${isOpenOrder}
      group by ${byDepartment}, ${labOrders.status}
      order by ${departmentOrder}`);
    const byDept = new Map();
    for (const r of raw) {
      const id = r.departmentId ?? null;
      let row = byDept.get(id);
      if (!row) {
        row = { departmentId: id, department: r.department, ...Object.fromEntries(OPEN_STATUSES.map((s) => [s, 0])), total: 0, pastDue: 0 };
        byDept.set(id, row);
      }
      if (OPEN_STATUSES.includes(r.status)) row[r.status] += num(r.orders);
      row.total += num(r.orders);
      row.pastDue += num(r.pastDue);
    }
    const rows = [...byDept.values()];
    return { rows, summary: { department: "Total", ...sums(rows, [...OPEN_STATUSES, "total", "pastDue"]) } };
  },
};

// ── Dept Orders ──────────────────────────────────────────────────────────

const deptOrders = {
  key: "departments.orders", group: GROUP, title: "Dept Orders",
  description: "Orders in each department: the open ones now, or those received in the range. Cancelled orders are not listed.",
  params: [
    { name: "scope", label: "Show", type: "select", default: "open", options: [{ value: "open", label: "Open now" }, { value: "received", label: "Received in range" }] },
    RANGE, DEPARTMENT,
  ],
  columns: [
    DEPT_COL, { id: "orderNumber", label: "Order #", type: "text", link: ORDER_LINK }, { id: "client", label: "Client", type: "text" },
    { id: "status", label: "Status", type: "badge" }, { id: "received", label: "Received", type: "date" },
    { id: "dueDate", label: "Due", type: "date" }, { id: "assignee", label: "Assigned to", type: "text" }, int("units", "Units"),
  ],
  async run(tx, { scope, range, department }) {
    const parts = [scope === "received" ? sql`${isLiveOrder} and ${labDayBetween(labOrders.receivedAt, range)}` : isOpenOrder];
    if (department) parts.push(sql`${labOrders.departmentId} = ${department}`);
    const raw = await rowsOf(tx, sql`
      select ${departmentName} as "department", ${labOrders.id} as "labOrderId", ${labOrders.orderNumber} as "orderNumber",
        ${clientName} as "client", ${labOrders.status} as "status", ${labDayText(labOrders.receivedAt)} as "receivedDay",
        to_char(${labOrders.dueDate}, 'YYYY-MM-DD') as "dueDate", ${assigneeName} as "assignee", u.units as "units"
      from ${labOrders} ${orderJoins} ${unitsJoin}
      where ${sql.join(parts, sql` and `)}
      order by ${departmentOrder}, ${labOrders.receivedAt}, ${labOrders.id}`);
    const rows = raw.map((r) => ({
      department: r.department, labOrderId: r.labOrderId, orderNumber: r.orderNumber, client: r.client ?? null, status: statusBadge(r.status),
      received: r.receivedDay, dueDate: r.dueDate ?? null, assignee: r.assignee, units: num(r.units),
    }));
    return { rows, summary: { department: "Total", units: sumOf(rows, "units") } };
  },
};

// ── Dept Completed / Dept Moved ──────────────────────────────────────────

const deptCompleted = {
  key: "departments.completed", group: GROUP, title: "Dept Completed",
  description: "Work each department finished in the range: orders moved on to another department, plus orders shipped from it.",
  params: [RANGE],
  columns: [DEPT_COL, int("movedOn", "Moved on"), int("shipped", "Shipped"), int("total", "Completed")],
  chart: { type: "stackedBar", x: "department", series: [{ field: "movedOn", label: "Moved on" }, { field: "shipped", label: "Shipped" }] },
  async run(tx, { range }) {
    const raw = await rowsOf(tx, sql`
      select k.department_id as "departmentId", coalesce(${labDepartments.name}, ${NO_DEPARTMENT}) as "department",
        sum(k.moved) as "movedOn", sum(k.shipped) as "shipped"
      from (
        select ${labOrderEvents.from} as department_id, count(*) as moved, 0 as shipped from ${labOrderEvents}
        where ${labOrderEvents.type} = 'department' and ${labOrderEvents.from} is not null and ${labDayBetween(labOrderEvents.at, range)}
        group by 1
        union all
        select ${labOrders.departmentId}, 0, count(*) from ${labOrders}
        where ${labOrders.status} = 'shipped' and ${labDayBetween(labOrders.shippedAt, range)}
        group by 1
      ) k
      left join ${labDepartments} on ${labDepartments.id} = k.department_id
      group by k.department_id, ${labDepartments.name}, ${labDepartments.position}
      order by (k.department_id is null), ${labDepartments.position}, 2`);
    const rows = raw.map((r) => ({
      departmentId: r.departmentId ?? null, department: r.department, movedOn: num(r.movedOn), shipped: num(r.shipped),
      total: num(r.movedOn) + num(r.shipped),
    }));
    return { rows, summary: { department: "Total", ...sums(rows, ["movedOn", "shipped", "total"]) } };
  },
};

const fromDept = alias(labDepartments, "from_dept");
const toDept = alias(labDepartments, "to_dept");
const mover = alias(users, "mover");
const asIso = (v) => (v instanceof Date ? v.toISOString() : v);

const deptMoved = {
  key: "departments.moved", group: GROUP, title: "Dept Moved",
  description: "Every move of an order between departments in the range: from, to, who moved it and when.",
  params: [RANGE],
  columns: [
    { id: "at", label: "When", type: "datetime", timeZone: LAB_TIMEZONE }, { id: "orderNumber", label: "Order #", type: "text", link: ORDER_LINK },
    { id: "from", label: "From", type: "text" }, { id: "to", label: "To", type: "text" }, { id: "by", label: "Moved by", type: "text" },
  ],
  async run(tx, { range }) {
    const raw = await rowsOf(tx, sql`
      select ${labOrderEvents.at} as "at", ${labOrders.id} as "labOrderId", ${labOrders.orderNumber} as "orderNumber",
        ${fromDept.name} as "fromName", ${toDept.name} as "toName", ${mover.name} as "byName"
      from ${labOrderEvents}
      join ${labOrders} on ${labOrders.id} = ${labOrderEvents.labOrderId}
      left join ${labDepartments} as from_dept on ${fromDept.id} = ${labOrderEvents.from}
      left join ${labDepartments} as to_dept on ${toDept.id} = ${labOrderEvents.to}
      left join ${users} as mover on ${mover.id} = ${labOrderEvents.byUserId}
      where ${labOrderEvents.type} = 'department' and ${labDayBetween(labOrderEvents.at, range)}
      order by ${labOrderEvents.at} desc, ${labOrderEvents.id}`);
    const rows = raw.map((r) => ({
      at: asIso(r.at), labOrderId: r.labOrderId, orderNumber: r.orderNumber,
      from: r.fromName ?? NO_DEPARTMENT, to: r.toName ?? NO_DEPARTMENT, by: r.byName ?? "System",
    }));
    return { rows };
  },
};

// ── Dept Summary / Dept Units ────────────────────────────────────────────

const deptSummary = {
  key: "departments.summary", group: GROUP, title: "Dept Summary",
  description: "Open orders and units in each department now, with past due, on hold and rush counts.",
  params: [],
  columns: [DEPT_COL, int("orders", "Open orders"), int("units", "Units"), int("pastDue", "Past due"), int("onHold", "On hold"), int("rush", "Rush")],
  async run(tx, _params, _actor, ctx) {
    const raw = await rowsOf(tx, sql`
      select ${labOrders.departmentId} as "departmentId", ${departmentName} as "department", count(*) as "orders",
        coalesce(sum(u.units), 0) as "units", count(*) filter (where ${pastDueSql(labToday(ctx))}) as "pastDue",
        count(*) filter (where ${isOnHold}) as "onHold", count(*) filter (where ${labOrders.rush}) as "rush"
      from ${labOrders} ${departmentJoin} ${unitsJoin}
      where ${isOpenOrder}
      group by ${byDepartment}
      order by ${departmentOrder}`);
    const ids = ["orders", "units", "pastDue", "onHold", "rush"];
    const rows = raw.map((r) => ({ departmentId: r.departmentId ?? null, department: r.department, ...Object.fromEntries(ids.map((k) => [k, num(r[k])])) }));
    return { rows, summary: { department: "Total", ...sums(rows, ids) } };
  },
};

const deptUnits = {
  key: "departments.units", group: GROUP, title: "Dept Units",
  description: "Product units on open orders in each department, by product category.",
  params: [],
  columns: [DEPT_COL, { id: "category", label: "Category", type: "text" }, int("units", "Units"), int("orders", "Orders")],
  chart: { type: "bar", x: "department", series: [{ field: "units", label: "Units" }] },
  async run(tx) {
    const raw = await rowsOf(tx, sql`
      select ${labOrders.departmentId} as "departmentId", ${departmentName} as "department",
        coalesce(${productFamilies.category}, ${uncategorizedSql}) as "category",
        sum(${labOrderLines.qty}) as "units", count(distinct ${labOrders.id}) as "orders"
      from ${labOrderLines}
      join ${labOrders} on ${labOrders.id} = ${labOrderLines.labOrderId}
      ${departmentJoin}
      ${catalogJoins(labOrderLines)}
      where ${labOrderLines.noteOnly} = false and ${isOpenOrder}
      group by ${byDepartment}, 3
      order by ${departmentOrder}, 4 desc`);
    const rows = raw.map((r) => ({ departmentId: r.departmentId ?? null, department: r.department, category: r.category, units: num(r.units), orders: num(r.orders) }));
    return { rows, summary: { department: "Total", units: sumOf(rows, "units") } };
  },
};

// ── Dept Tasks / Dept Tasks Summary (piece 7) ────────────────────────────

const RANGE_TASKS = { ...RANGE, default: "last7" };

const deptTasks = {
  key: "departments.tasks", group: GROUP, title: "Dept Tasks", requires: ["workflows"],
  description: "Workflow stage targets falling in the range, by the order's department and the stage, with whether each is done or behind.",
  params: [RANGE_TASKS, DEPARTMENT],
  columns: [
    DEPT_COL, { id: "stage", label: "Stage", type: "text" }, { id: "orderNumber", label: "Order #", type: "text", link: ORDER_LINK },
    { id: "target", label: "Stage target", type: "date" }, { id: "state", label: "Done?", type: "badge" },
    { id: "assignee", label: "Assigned to", type: "text" }, { id: "status", label: "Order status", type: "badge" },
  ],
  async run(tx, { range, department }, _actor, ctx) {
    const targets = stageTargets(await plannedOrders(tx, { range, department }), labToday(ctx), await labCalendar(tx), range);
    const rows = targets
      .sort((a, b) => byName("department", "departmentId")(a, b) || a.position - b.position || a.target.localeCompare(b.target) || a.orderNumber - b.orderNumber)
      .map(taskRow);
    return { rows };
  },
};

const deptTasksSummary = {
  key: "departments.tasks-summary", group: GROUP, title: "Dept Tasks Summary", requires: ["workflows"],
  description: "Workflow stage targets in the range per department (the order's): due, done and behind.",
  params: [RANGE_TASKS],
  columns: [DEPT_COL, int("due", "Due"), int("done", "Done"), int("behind", "Behind")],
  async run(tx, { range }, _actor, ctx) {
    const targets = stageTargets(await plannedOrders(tx, { range }), labToday(ctx), await labCalendar(tx), range);
    const rows = countTargets(targets, (t) => t.departmentId ?? "", (t) => ({ departmentId: t.departmentId, department: t.department }))
      .sort(byName("department", "departmentId"));
    return { rows, summary: { department: "Total", ...sums(rows, ["due", "done", "behind"]) } };
  },
};

export const DEPARTMENT_REPORTS = [monitoringBoards, deptOrders, deptCompleted, deptMoved, deptSummary, deptUnits, deptTasks, deptTasksSummary];

export function registerDepartmentReports(registry) {
  for (const def of DEPARTMENT_REPORTS) registry.defineReport(def);
}
