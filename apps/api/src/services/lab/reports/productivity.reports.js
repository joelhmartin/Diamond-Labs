/**
 * Productivity (7). Staff. Orders are lab orders by lab-local received day
 * (cancelled ones count only where a report lets you filter by status);
 * completed = shipped; turnaround = business days received → shipped
 * (lab-metrics turnaroundDaysSql over piece 7's calendar). "Tasks
 * completed" are status moves (spec ruling): lab_order_events of type status,
 * by the person who made them. No report selects a patient or a note.
 */
import { sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { LAB_ORDER_SOURCES, LAB_ORDER_SOURCE_LABELS, LAB_ORDER_STATUSES, LAB_STATUS_LABELS, monthsBetween } from "@my-app/shared";
import { labOrders, labOrderEvents, labOrderLines, productFamilies, users, doctorProfiles, adjustmentReasons } from "../../../db/schema/index.js";
import { tagsFor, taggedWithAny } from "../../../modules/record-tags/index.js";
import { LAB_ORDER_RECORD_TYPE } from "../lab-tags.js";
import {
  ORDER_LINK, beforeCoverage, catalogJoins, clientName, isClient, isLiveOrder, labCalendar, labDayBetween, labDayText, labMonthText, labToday, num,
  orderAndPage, rowsOf, turnaroundDaysSql,
} from "./lab-metrics.js";
import { assigneeJoin, assigneeName, orderJoins, shippedInSql, statusBadge, unitsJoin } from "./order-metrics.js";
import { PRACTICE_PARAMS, andPractice, int, sumOf, sums, uncategorizedSql } from "./report-helpers.js";

const GROUP = "productivity";
const RANGE = { name: "range", label: "Dates", type: "dateRange", default: "last30", maxDays: 1100 };
const days = (id, label) => ({ id, label, type: "duration_days" });
const orNull = (v) => (v == null ? null : Number(v));
const inList = (col, values) => sql`${col} in (${sql.join(values.map((v) => sql`${v}`), sql`, `)})`;

// ── Orders (server paged) ────────────────────────────────────────────────

const optionsOf = (labels) => Object.entries(labels).map(([value, label]) => ({ value, label }));

/**
 * Filters: status, source, a label (piece 6 record-tags on lab orders, via
 * taggedWithAny) and a practice or group (PRACTICE_PARAMS: those lookups
 * carry no money, so staff may use them); each row lists its labels
 * (tagsFor). There is no client (doctor) filter: the client lookup is admin
 * only (it backs the money reports) and this report is staff.
 */
const orders = {
  key: "productivity.orders", group: GROUP, featured: true, title: "Orders", paging: "server",
  description: "Orders received in the range with their client, source, status, dates, units and labels. Filter by status, source and label.",
  params: [
    RANGE,
    { name: "status", label: "Status", type: "multiselect", options: optionsOf(LAB_STATUS_LABELS) },
    { name: "source", label: "Source", type: "multiselect", options: optionsOf(LAB_ORDER_SOURCE_LABELS) },
    { name: "tag", label: "Label", type: "lookup", source: "tag" },
    ...PRACTICE_PARAMS,
  ],
  columns: [
    { id: "received", label: "Received", type: "date" }, { id: "orderNumber", label: "Order #", type: "text", link: ORDER_LINK },
    { id: "client", label: "Client", type: "text" }, { id: "source", label: "Source", type: "badge" },
    { id: "status", label: "Status", type: "badge" }, { id: "dueDate", label: "Due", type: "date" },
    { id: "shipped", label: "Shipped", type: "date" }, { id: "rush", label: "Rush", type: "text" },
    { id: "remake", label: "Remake", type: "text" }, int("units", "Units"), { id: "tags", label: "Labels", type: "text", sortable: false },
  ],
  async run(tx, params, _actor, ctx) {
    const { range, status, source, tag } = params;
    const parts = [sql`${labDayBetween(labOrders.receivedAt, range)}${andPractice(params, labOrders.accountId)}`];
    const statuses = (status ?? []).filter((s) => LAB_ORDER_STATUSES.includes(s));
    const sources = (source ?? []).filter((s) => LAB_ORDER_SOURCES.includes(s));
    if (statuses.length) parts.push(inList(labOrders.status, statuses));
    if (sources.length) parts.push(inList(labOrders.source, sources));
    if (tag) parts.push(taggedWithAny(LAB_ORDER_RECORD_TYPE, labOrders.id, [tag]));
    const where = sql`where ${sql.join(parts, sql` and `)}`;
    const sorts = {
      received: labOrders.receivedAt, orderNumber: labOrders.orderNumber, client: clientName, source: labOrders.source,
      status: labOrders.status, dueDate: labOrders.dueDate, shipped: labOrders.shippedAt, rush: labOrders.rush,
      remake: labOrders.isRemake, units: sql`u.units`,
    };
    const [count] = await rowsOf(tx, sql`select count(*) as "total" from ${labOrders} ${where}`);
    const raw = await rowsOf(tx, sql`
      select ${labOrders.id} as "labOrderId", ${labOrders.orderNumber} as "orderNumber", ${labDayText(labOrders.receivedAt)} as "receivedDay",
        ${clientName} as "client", ${labOrders.source} as "source", ${labOrders.status} as "status",
        to_char(${labOrders.dueDate}, 'YYYY-MM-DD') as "dueDate", ${labDayText(labOrders.shippedAt)} as "shippedDay",
        ${labOrders.rush} as "rush", ${labOrders.isRemake} as "isRemake", u.units as "units"
      from ${labOrders}
      left join ${users} on ${users.id} = ${labOrders.clientUserId}
      left join ${doctorProfiles} on ${doctorProfiles.userId} = ${users.id}
      ${unitsJoin}
      ${where}
      ${orderAndPage(ctx?.page, sorts, { id: "received", desc: true }, labOrders.id)}`);
    const rows = raw.map((r) => ({
      labOrderId: r.labOrderId, orderNumber: r.orderNumber, received: r.receivedDay, client: r.client ?? null,
      source: { value: r.source, label: LAB_ORDER_SOURCE_LABELS[r.source] ?? r.source }, status: statusBadge(r.status),
      dueDate: r.dueDate ?? null, shipped: r.shippedDay ?? null, rush: r.rush ? "Rush" : "", remake: r.isRemake ? "Remake" : "",
      units: num(r.units), tags: "",
    }));
    const labels = await tagsFor(LAB_ORDER_RECORD_TYPE, rows.map((r) => r.labOrderId), tx);
    for (const r of rows) r.tags = (labels.get(r.labOrderId) ?? []).map((t) => t.label).join(", ");
    return { rows, total: num(count?.total) };
  },
};

// ── Orders Completed / Tasks Completed ───────────────────────────────────

const ordersCompleted = {
  key: "productivity.orders-completed", group: GROUP, featured: true, title: "Orders Completed",
  description: "Orders shipped in the range per person they were assigned to, with units and average turnaround (business days).",
  params: [RANGE],
  columns: [
    { id: "assignee", label: "Assigned to", type: "text" }, int("orders", "Orders"), int("units", "Units"),
    int("rush", "Rush"), days("avgDays", "Avg turnaround"),
  ],
  chart: { type: "bar", x: "assignee", series: [{ field: "orders", label: "Orders" }] },
  async run(tx, { range }) {
    const calendar = await labCalendar(tx);
    const raw = await rowsOf(tx, sql`
      select ${labOrders.assigneeUserId} as "assigneeUserId", ${assigneeName} as "assignee", count(*) as "orders",
        coalesce(sum(u.units), 0) as "units", count(*) filter (where ${labOrders.rush}) as "rush", avg(${turnaroundDaysSql(calendar)}) as "avgDays"
      from ${labOrders} ${assigneeJoin} ${unitsJoin}
      where ${shippedInSql(range)}
      group by ${labOrders.assigneeUserId}, assignee.name
      order by 3 desc, 2`);
    const rows = raw.map((r) => ({
      assigneeUserId: r.assigneeUserId ?? null, assignee: r.assignee, orders: num(r.orders), units: num(r.units), rush: num(r.rush), avgDays: orNull(r.avgDays),
    }));
    return { rows, summary: { assignee: "Total", ...sums(rows, ["orders", "units", "rush"]) } };
  },
};

const tasksCompleted = {
  key: "productivity.tasks-completed", group: GROUP, featured: true, title: "Tasks Completed",
  description: "Status moves each person made in the range, by the status they moved the order to. Putting an order on hold counts too (it is recorded as a hold event). Moves the system made (checkout, imports) are not counted.",
  params: [RANGE],
  columns: [
    { id: "user", label: "Person", type: "text" },
    ...LAB_ORDER_STATUSES.map((s) => int(s, LAB_STATUS_LABELS[s] ?? s)),
    int("total", "Total"),
  ],
  async run(tx, { range }) {
    const raw = await rowsOf(tx, sql`
      select ${labOrderEvents.byUserId} as "userId", ${users.name} as "user", ${labOrderEvents.to} as "toStatus", count(*) as "moves"
      from ${labOrderEvents}
      left join ${users} on ${users.id} = ${labOrderEvents.byUserId}
      where ${labOrderEvents.type} in ('status', 'hold') and ${labOrderEvents.byUserId} is not null and ${labDayBetween(labOrderEvents.at, range)}
      group by ${labOrderEvents.byUserId}, ${users.name}, ${labOrderEvents.to}
      order by 2, 1`);
    const byUser = new Map();
    for (const r of raw) {
      let row = byUser.get(r.userId);
      if (!row) {
        row = { userId: r.userId, user: r.user ?? "Unknown user", ...Object.fromEntries(LAB_ORDER_STATUSES.map((s) => [s, 0])), total: 0 };
        byUser.set(r.userId, row);
      }
      const n = num(r.moves);
      if (Object.hasOwn(row, r.toStatus) && LAB_ORDER_STATUSES.includes(r.toStatus)) row[r.toStatus] += n;
      row.total += n;
    }
    const rows = [...byUser.values()];
    return { rows, summary: { user: "Total", ...sums(rows, [...LAB_ORDER_STATUSES, "total"]) } };
  },
};

// ── Monthly Counts / Monthly Orders ──────────────────────────────────────

const monthlyCounts = {
  key: "productivity.monthly-counts", group: GROUP, title: "Monthly Counts",
  description: "Orders and units received per month, with rush orders and remakes. Cancelled orders are not counted.",
  params: [{ ...RANGE, default: "last12m" }, ...PRACTICE_PARAMS],
  columns: [{ id: "month", label: "Month", type: "text" }, int("orders", "Orders"), int("units", "Units"), int("rush", "Rush"), int("remakes", "Remakes")],
  chart: { type: "bar", x: "month", series: [{ field: "orders", label: "Orders" }, { field: "units", label: "Units" }] },
  async run(tx, params) {
    const { range } = params;
    const raw = await rowsOf(tx, sql`
      select ${labMonthText(labOrders.receivedAt)} as "month", count(*) as "orders", coalesce(sum(u.units), 0) as "units",
        count(*) filter (where ${labOrders.rush}) as "rush", count(*) filter (where ${labOrders.isRemake}) as "remakes"
      from ${labOrders} ${unitsJoin}
      where ${isLiveOrder} and ${labDayBetween(labOrders.receivedAt, range)}${andPractice(params, labOrders.accountId)}
      group by 1 order by 1`);
    const byMonth = new Map(raw.map((r) => [String(r.month), r]));
    const rows = monthsBetween(range.from, range.to).map((month) => {
      const r = byMonth.get(month) ?? {};
      return { month, orders: num(r.orders), units: num(r.units), rush: num(r.rush), remakes: num(r.remakes) };
    });
    return { rows, summary: { month: "Total", ...sums(rows, ["orders", "units", "rush", "remakes"]) } };
  },
};

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_IDS = MONTH_LABELS.map((_, i) => `m${String(i + 1).padStart(2, "0")}`);

const monthlyOrders = {
  key: "productivity.monthly-orders", group: GROUP, title: "Monthly Orders",
  description: "Orders per client per month for a year (cancelled orders are not counted), busiest clients first.",
  params: [{ name: "year", label: "Year (default this year)", type: "number", min: 2000, max: 2100 }, ...PRACTICE_PARAMS],
  columns: [
    { id: "client", label: "Client", type: "text" },
    ...MONTH_IDS.map((id, i) => int(id, MONTH_LABELS[i])),
    int("total", "Total"),
  ],
  async run(tx, params, _actor, ctx) {
    const year = Number.isInteger(params?.year) ? params.year : Number(labToday(ctx).slice(0, 4));
    const raw = await rowsOf(tx, sql`
      select ${users.id} as "clientUserId", ${clientName} as "client", ${labMonthText(labOrders.receivedAt)} as "month", count(*) as "orders"
      from ${labOrders}
      join ${users} on ${users.id} = ${labOrders.clientUserId} and ${isClient}
      left join ${doctorProfiles} on ${doctorProfiles.userId} = ${users.id}
      where ${isLiveOrder} and ${labDayBetween(labOrders.receivedAt, { from: `${year}-01-01`, to: `${year}-12-31` })}${andPractice(params, labOrders.accountId)}
      group by ${users.id}, ${doctorProfiles.companyName}, ${users.name}, 3`);
    const byClient = new Map();
    for (const r of raw) {
      let row = byClient.get(r.clientUserId);
      if (!row) {
        row = { clientUserId: r.clientUserId, client: r.client, ...Object.fromEntries(MONTH_IDS.map((id) => [id, 0])), total: 0 };
        byClient.set(r.clientUserId, row);
      }
      const id = `m${String(r.month).slice(5, 7)}`;
      if (Object.hasOwn(row, id)) row[id] += num(r.orders);
      row.total += num(r.orders);
    }
    const rows = [...byClient.values()].sort((a, b) => b.total - a.total || String(a.client).localeCompare(String(b.client)));
    return { rows, summary: { client: "Total", ...sums(rows, [...MONTH_IDS, "total"]) }, notice: `Orders received in ${year}.` };
  },
};

// ── Remakes ──────────────────────────────────────────────────────────────

/**
 * The import does not carry Seazona's remake flag (spec premise 3), so before
 * cutover remakes read as zero. Shown whenever the range starts before
 * REPORTS_COVERAGE_FROM, or always while it is unset.
 */
export function remakeCoverageNotice(range, coverageFrom = process.env.REPORTS_COVERAGE_FROM) {
  if (!beforeCoverage(range, coverageFrom)) return null;
  const since = coverageFrom ? ` (history before ${coverageFrom})` : "";
  return `Imported orders are not flagged as remakes${since}, so remakes before cutover read as zero.`;
}

const original = alias(labOrders, "original");
/** A remake made without a reason from the list (or before piece 6). */
const NO_REASON = "No reason given";
const pct = (part, whole) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : "0.0%");

const remakes = {
  key: "productivity.remakes", group: GROUP, title: "Remakes",
  description: "Remake orders received in the range, with the original order, the client, the remake reason and the remake rate.",
  params: [RANGE, ...PRACTICE_PARAMS],
  columns: [
    { id: "received", label: "Received", type: "date" }, { id: "orderNumber", label: "Remake #", type: "text", link: ORDER_LINK },
    { id: "originalNumber", label: "Original #", type: "text", link: "/lab/orders/{originalId}" },
    { id: "client", label: "Client", type: "text" }, { id: "reason", label: "Reason", type: "text" },
    { id: "status", label: "Status", type: "badge" }, { id: "assignee", label: "Assigned to", type: "text" },
  ],
  async run(tx, params) {
    const { range } = params;
    const inPractice = andPractice(params, labOrders.accountId);
    const raw = await rowsOf(tx, sql`
      select ${labOrders.id} as "labOrderId", ${labOrders.orderNumber} as "orderNumber", ${labDayText(labOrders.receivedAt)} as "receivedDay",
        ${original.id} as "originalId", ${original.orderNumber} as "originalNumber", ${clientName} as "client",
        ${labOrders.status} as "status", ${assigneeName} as "assignee", ${adjustmentReasons.label} as "reason"
      from ${labOrders} ${orderJoins}
      left join ${labOrders} as original on ${original.id} = ${labOrders.remakeOfOrderId}
      left join ${adjustmentReasons} on ${adjustmentReasons.id} = ${labOrders.remakeReasonId}
      where ${labOrders.isRemake} and ${isLiveOrder} and ${labDayBetween(labOrders.receivedAt, range)}${inPractice}
      order by ${labOrders.receivedAt} desc, ${labOrders.id}`);
    const [all] = await rowsOf(tx, sql`
      select count(*) as "orders" from ${labOrders} where ${isLiveOrder} and ${labDayBetween(labOrders.receivedAt, range)}${inPractice}`);
    const rows = raw.map((r) => ({
      labOrderId: r.labOrderId, orderNumber: r.orderNumber, received: r.receivedDay, originalId: r.originalId ?? null,
      originalNumber: r.originalNumber ?? null, client: r.client ?? null, reason: r.reason ?? NO_REASON, status: statusBadge(r.status), assignee: r.assignee,
    }));
    const total = num(all?.orders);
    const rate = `${rows.length} remake${rows.length === 1 ? "" : "s"} of ${total} orders received (${pct(rows.length, total)}).`;
    return { rows, notice: [rate, remakeCoverageNotice(range)].filter(Boolean).join(" ") };
  },
};

// ── Turnaround Times ─────────────────────────────────────────────────────

/** An order's category: its first product line's catalog family. */
const firstCategory = sql`
  left join lateral (
    select ${productFamilies.category} as category from ${labOrderLines} ${catalogJoins(labOrderLines)}
    where ${labOrderLines.labOrderId} = ${labOrders.id} and ${labOrderLines.noteOnly} = false
    order by ${labOrderLines.position}, ${labOrderLines.id} limit 1
  ) cat on true`;

const turnaround = {
  key: "productivity.turnaround", group: GROUP, title: "Turnaround Times",
  description: "Average and median business days (the lab calendar's open days) from received to shipped, by month shipped and product category (the order's first product). Unshipped and cancelled orders are not counted.",
  params: [{ ...RANGE, default: "last12m" }, ...PRACTICE_PARAMS],
  columns: [
    { id: "month", label: "Month shipped", type: "text" }, { id: "category", label: "Category", type: "text" },
    int("orders", "Orders"), days("avgDays", "Average"), days("medianDays", "Median"),
  ],
  async run(tx, params) {
    const { range } = params;
    const calendar = await labCalendar(tx);
    const raw = await rowsOf(tx, sql`
      select x.month as "month", x.category as "category", count(*) as "orders", avg(x.days) as "avgDays",
        percentile_cont(0.5) within group (order by x.days) as "medianDays", grouping(x.month) as "isTotal"
      from (
        select ${labMonthText(labOrders.shippedAt)} as month, coalesce(cat.category, ${uncategorizedSql}) as category, ${turnaroundDaysSql(calendar)} as days
        from ${labOrders} ${firstCategory}
        where ${shippedInSql(range)}${andPractice(params, labOrders.accountId)}
      ) x
      group by grouping sets ((x.month, x.category), ())
      order by 6, 1, 2`);
    const shaped = (r) => ({ orders: num(r.orders), avgDays: orNull(r.avgDays), medianDays: orNull(r.medianDays) });
    const rows = raw.filter((r) => Number(r.isTotal) !== 1).map((r) => ({ month: r.month, category: r.category, ...shaped(r) }));
    const all = raw.find((r) => Number(r.isTotal) === 1);
    return { rows, summary: all ? { month: "All", ...shaped(all) } : undefined };
  },
};

export const PRODUCTIVITY_REPORTS = [orders, ordersCompleted, tasksCompleted, monthlyCounts, monthlyOrders, remakes, turnaround];

export function registerProductivityReports(registry) {
  for (const def of PRODUCTIVITY_REPORTS) registry.defineReport(def);
}
