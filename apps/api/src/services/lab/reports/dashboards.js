/**
 * The lab's dashboards (spec "Dashboards (lab glue)"): Pulse, Operations,
 * Insights (admin) and Sales (admin), their stat metrics, and the few
 * dashboard-only reports behind their chart and table tiles.
 *
 * One implementation per number: every metric and tile calls the shared
 * function the matching report uses (lab-metrics, order-metrics,
 * client-health). Board counts always come from `boardDayCounts`, the seam
 * piece 7 re-points. Dashboard-only reports are `unlisted` (they are not in
 * the 63-report index, but open by URL like any report).
 *
 * Money metrics and tiles are admin only, so a lab user's Pulse simply has no
 * Sales today tile. Tiles are cached per role, so nothing here depends on
 * actor.id. Each metric returns `{ value, previous, format, href, detail? }`;
 * `detail` is a list of `{ id, label, value }` counts shown under the value.
 */
import { addDays } from "@my-app/shared";
import { CLIENT_LINK, ORDER_LINK, labToday, salesByDay, salesCents } from "./lab-metrics.js";
import {
  atRiskOrders, boardDayCounts, dueByDay, openUnitsByCategory, ordersByDay, shippedByDay, statusBadge, turnaroundAverage, turnaroundByWeek, weekStart,
} from "./order-metrics.js";
import { HEALTH_BANDS, clientHealthRows, healthCounts } from "./client-health.js";
import { activityFeedReport } from "./activity-feed.js";

const ADMIN = ["admin"];
const TOP_CLIENTS = 10;
const DUE_DAYS = 14;
const TREND_WEEKS = 26;

// ── Helpers ──────────────────────────────────────────────────────────────

/** A report page link with its params, as the web reads them (`/reports/<key>?p.<name>=<value>`). */
export function reportHref(key, params = {}) {
  const q = Object.entries(params).map(([k, v]) => `p.${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  return `/reports/${encodeURIComponent(key)}${q ? `?${q}` : ""}`;
}

const stat = (value, { previous = null, format = "int", href, detail } = {}) => ({ value, previous, format, href, ...(detail ? { detail } : {}) });
const sum = (rows, k) => rows.reduce((s, r) => s + (r[k] ?? 0), 0);

/** The same month and day a year earlier; Feb 29 becomes Feb 28. */
export function sameDayLastYear(day) {
  const [y, m, d] = day.split("-");
  return `${Number(y) - 1}-${m}-${m === "02" && d === "29" ? "28" : d}`;
}

/** Last month's days 1..today's day (capped at that month's last day). */
export function monthToDateBefore(day) {
  const first = `${day.slice(0, 7)}-01`;
  const lastOfPrev = addDays(first, -1);
  const from = `${lastOfPrev.slice(0, 7)}-01`;
  const sameDay = `${lastOfPrev.slice(0, 7)}-${day.slice(8)}`;
  return { from, to: sameDay < lastOfPrev ? sameDay : lastOfPrev };
}

const asOfOf = (ctx) => ctx?.now ?? new Date();

// ── Metrics ──────────────────────────────────────────────────────────────

/** A board count (boardDayCounts field) linking to the report that lists it. */
const boardMetric = (key, field, href) => ({
  key,
  async run(tx, _params, _actor, ctx) {
    const counts = await boardDayCounts(tx, labToday(ctx));
    return stat(counts[field], { href });
  },
});

const OPS_METRICS = [
  boardMetric("ops.past-due", "pastDue", reportHref("departments.monitoring-boards")),
  boardMetric("ops.at-risk", "atRisk", reportHref("ops.at-risk-orders")),
  boardMetric("ops.due-today", "dueToday", reportHref("ops.due-by-day")),
  boardMetric("ops.due-tomorrow", "dueTomorrow", reportHref("ops.due-by-day")),
  boardMetric("ops.on-hold", "onHold", reportHref("planning.technician-workload")),
  {
    // Today so far: no previous (a part day against a whole day would mislead).
    key: "ops.new-today",
    async run(tx, _params, _actor, ctx) {
      const today = labToday(ctx);
      const [day] = await ordersByDay(tx, { from: today, to: today });
      return stat(day.orders, { href: reportHref("operations.daily-orders", { range: "today" }) });
    },
  },
  {
    key: "ops.shipped-today",
    async run(tx, _params, _actor, ctx) {
      const today = labToday(ctx);
      const [day] = await shippedByDay(tx, { from: today, to: today });
      return stat(day.orders, { href: reportHref("operations.daily-shipments", { range: "today" }) });
    },
  },
  {
    key: "ops.shipped-yesterday",
    async run(tx, _params, _actor, ctx) {
      const yesterday = addDays(labToday(ctx), -1);
      const [before, day] = await shippedByDay(tx, { from: addDays(yesterday, -1), to: yesterday });
      return stat(day.orders, { previous: before.orders, href: reportHref("operations.daily-shipments", { range: "yesterday" }) });
    },
  },
];

const SALES_METRICS = [
  {
    key: "sales.today", roles: ADMIN,
    async run(tx, _params, _actor, ctx) {
      const today = labToday(ctx);
      return stat(await salesCents(tx, { from: today, to: today }), { format: "money", href: reportHref("sales.daily", { range: "today" }) });
    },
  },
  {
    // Previous = Jan 1 .. the same month/day last year.
    key: "sales.ytd", roles: ADMIN,
    async run(tx, _params, _actor, ctx) {
      const today = labToday(ctx);
      const lastYear = sameDayLastYear(today);
      const value = await salesCents(tx, { from: `${today.slice(0, 4)}-01-01`, to: today });
      const previous = await salesCents(tx, { from: `${lastYear.slice(0, 4)}-01-01`, to: lastYear });
      return stat(value, { previous, format: "money", href: reportHref("sales.comparison") });
    },
  },
  {
    // $ month to date, with its invoice count (one invoice per order) as detail. Previous = the same days last month.
    key: "sales.mtd", roles: ADMIN,
    async run(tx, _params, _actor, ctx) {
      const today = labToday(ctx);
      const days = await salesByDay(tx, { from: `${today.slice(0, 7)}-01`, to: today });
      const previous = await salesCents(tx, monthToDateBefore(today));
      return stat(sum(days, "cents"), {
        previous, format: "money", href: reportHref("sales.daily", { range: "mtd" }),
        detail: [{ id: "invoices", label: "invoices", value: sum(days, "invoices") }],
      });
    },
  },
];

const INSIGHT_METRICS = [
  {
    key: "insights.orders-30", roles: ADMIN,
    async run(tx, _params, _actor, ctx) {
      const today = labToday(ctx);
      const days = await ordersByDay(tx, { from: addDays(today, -59), to: today });
      return stat(sum(days.slice(30), "orders"), {
        previous: sum(days.slice(0, 30), "orders"), href: reportHref("operations.daily-orders", { range: "last30" }),
      });
    },
  },
  {
    // Active = not Inactive; clients who never ordered have no health row.
    key: "insights.active-clients", roles: ADMIN,
    async run(tx, _params, _actor, ctx) {
      const c = healthCounts(await clientHealthRows(tx, { asOf: asOfOf(ctx) }));
      return stat(c.active, {
        href: reportHref("clients.health"),
        detail: [{ id: "declining", label: "declining", value: c.declining }, { id: "inactive", label: "inactive", value: c.inactive }],
      });
    },
  },
  {
    key: "insights.avg-turnaround-30", roles: ADMIN,
    async run(tx, _params, _actor, ctx) {
      const today = labToday(ctx);
      const now = await turnaroundAverage(tx, { from: addDays(today, -29), to: today });
      const before = await turnaroundAverage(tx, { from: addDays(today, -59), to: addDays(today, -30) });
      return stat(now.avgDays, { previous: before.avgDays, format: "duration_days", href: reportHref("productivity.turnaround", { range: "last30" }) });
    },
  },
];

export const LAB_METRICS = [...OPS_METRICS, ...SALES_METRICS, ...INSIGHT_METRICS];

// ── Dashboard-only reports (unlisted) ────────────────────────────────────

const int = (id, label) => ({ id, label, type: "int" });

const atRiskList = {
  key: "ops.at-risk-orders", group: "operations", unlisted: true, title: "At-risk orders",
  description: "Open orders still received or in production and due today through the next 2 days, soonest first.",
  params: [],
  columns: [
    { id: "orderNumber", label: "Order #", type: "text", link: ORDER_LINK }, { id: "client", label: "Client", type: "text" },
    { id: "status", label: "Status", type: "badge" }, { id: "dueDate", label: "Due", type: "date" }, { id: "rush", label: "Rush", type: "text" },
  ],
  async run(tx, _params, _actor, ctx) {
    const rows = (await atRiskOrders(tx, labToday(ctx))).map((o) => ({
      labOrderId: o.id, orderNumber: o.orderNumber, client: o.client, status: statusBadge(o.status), dueDate: o.dueDate, rush: o.rush ? "Rush" : "",
    }));
    return { rows };
  },
};

const dueDays = {
  key: "ops.due-by-day", group: "operations", unlisted: true, title: `Orders due, next ${DUE_DAYS} days`,
  description: `Open orders by due date, today and the ${DUE_DAYS - 1} days after.`,
  params: [],
  columns: [{ id: "day", label: "Due", type: "date" }, int("orders", "Orders"), int("rush", "Rush")],
  chart: { type: "bar", x: "day", series: [{ field: "orders", label: "Orders" }] },
  async run(tx, _params, _actor, ctx) {
    const today = labToday(ctx);
    const rows = await dueByDay(tx, { from: today, to: addDays(today, DUE_DAYS - 1) });
    return { rows, summary: { day: "Total", orders: sum(rows, "orders"), rush: sum(rows, "rush") } };
  },
};

const openUnits = {
  key: "ops.open-units", group: "operations", unlisted: true, title: "Units in open orders by category",
  description: "Product units on open (not shipped, not cancelled) orders, by catalog category.",
  params: [],
  columns: [{ id: "category", label: "Category", type: "text" }, int("units", "Units"), int("orders", "Orders")],
  chart: { type: "bar", x: "category", series: [{ field: "units", label: "Units" }] },
  async run(tx) {
    const rows = await openUnitsByCategory(tx);
    return { rows, summary: { category: "Total", units: sum(rows, "units") } };
  },
};

const turnaroundTrend = {
  key: "ops.turnaround-weekly", group: "operations", unlisted: true, title: "Turnaround by week",
  description: `Average days received → shipped per week shipped (Monday start), the last ${TREND_WEEKS} weeks. Calendar days.`,
  params: [],
  columns: [{ id: "week", label: "Week of", type: "date" }, int("orders", "Orders shipped"), { id: "avgDays", label: "Average", type: "duration_days" }],
  chart: { type: "line", x: "week", series: [{ field: "avgDays", label: "Average days" }] },
  async run(tx, _params, _actor, ctx) {
    const today = labToday(ctx);
    return { rows: await turnaroundByWeek(tx, { from: addDays(weekStart(today), -7 * (TREND_WEEKS - 1)), to: today }) };
  },
};

const BAND_LABEL = Object.fromEntries(HEALTH_BANDS.map((b) => [b.value, b.label]));

const topClients = {
  key: "insights.top-clients", group: "clients", roles: ADMIN, unlisted: true, title: "Top clients by volume",
  description: `The ${TOP_CLIENTS} clients with the most orders in the last 30 days, with their health band and 30-day sales.`,
  params: [],
  columns: [
    { id: "client", label: "Client", type: "text", link: CLIENT_LINK }, int("recent", "Orders (30 days)"),
    { id: "band", label: "Health", type: "badge" }, { id: "sales30", label: "Sales (30 days)", type: "money" },
  ],
  async run(tx, _params, _actor, ctx) {
    const rows = (await clientHealthRows(tx, { asOf: asOfOf(ctx) }))
      .filter((r) => r.recent > 0)
      .sort((a, b) => b.recent - a.recent || b.sales30Cents - a.sales30Cents || String(a.client).localeCompare(String(b.client)))
      .slice(0, TOP_CLIENTS)
      .map((r) => ({
        clientUserId: r.clientUserId, client: r.client, recent: r.recent, band: { value: r.band, label: BAND_LABEL[r.band] }, sales30: r.sales30Cents,
      }));
    return { rows };
  },
};

const healthBands = {
  key: "insights.health-bands", group: "clients", roles: ADMIN, unlisted: true, title: "Client health bands",
  description: "How many clients who have ordered are in each health band (the Client Health rule).",
  params: [],
  columns: [{ id: "band", label: "Health", type: "text" }, int("clients", "Clients")],
  chart: { type: "bar", x: "band", series: [{ field: "clients", label: "Clients" }] },
  async run(tx, _params, _actor, ctx) {
    const all = await clientHealthRows(tx, { asOf: asOfOf(ctx) });
    const rows = HEALTH_BANDS.map((b) => ({ band: b.label, clients: all.filter((r) => r.band === b.value).length }));
    return { rows, summary: { band: "Total", clients: all.length } };
  },
};

export const LAB_DASHBOARD_REPORTS = [activityFeedReport, atRiskList, dueDays, openUnits, turnaroundTrend, topClients, healthBands];

// ── Dashboards ───────────────────────────────────────────────────────────

const statTile = (id, metric, title) => ({ id, kind: "stat", metric, title });

export const LAB_DASHBOARDS = [
  {
    key: "pulse", title: "Pulse",
    tiles: [
      statTile("past-due", "ops.past-due", "Past due"),
      statTile("at-risk", "ops.at-risk", "At risk"),
      statTile("new-today", "ops.new-today", "New cases today"),
      statTile("sales-today", "sales.today", "Sales today"),
      statTile("shipped-today", "ops.shipped-today", "Shipped today"),
      statTile("shipped-yesterday", "ops.shipped-yesterday", "Shipped yesterday"),
      statTile("on-hold", "ops.on-hold", "On hold"),
      { id: "at-risk-list", kind: "table", report: "ops.at-risk-orders", title: "At-risk orders", span: 2 },
      { id: "feed", kind: "feed", report: "ops.activity-feed", title: "Live activity", span: 2 },
    ],
  },
  {
    key: "operations", title: "Operations",
    tiles: [
      statTile("past-due", "ops.past-due", "Past due"),
      statTile("due-today", "ops.due-today", "Due today"),
      statTile("due-tomorrow", "ops.due-tomorrow", "Due tomorrow"),
      statTile("on-hold", "ops.on-hold", "On hold"),
      { id: "open-units", kind: "chart", report: "ops.open-units", title: "Units in open orders by category", span: 2 },
      { id: "due-by-day", kind: "chart", report: "ops.due-by-day", title: `Orders due, next ${DUE_DAYS} days`, span: 2 },
      { id: "turnaround", kind: "chart", report: "ops.turnaround-weekly", title: `Turnaround, last ${TREND_WEEKS} weeks`, span: 4 },
    ],
  },
  {
    key: "insights", title: "Insights", roles: ADMIN,
    tiles: [
      statTile("orders-30", "insights.orders-30", "Orders, last 30 days"),
      statTile("active-clients", "insights.active-clients", "Active clients"),
      statTile("avg-turnaround", "insights.avg-turnaround-30", "Avg turnaround, 30 days"),
      { id: "top-clients", kind: "table", report: "insights.top-clients", title: "Top clients by volume", span: 2 },
      { id: "health-bands", kind: "chart", report: "insights.health-bands", title: "Client health", span: 2 },
    ],
  },
  {
    key: "sales", title: "Sales", roles: ADMIN,
    tiles: [
      statTile("ytd", "sales.ytd", "Sales year to date"),
      statTile("mtd", "sales.mtd", "Sales month to date"),
      { id: "comparison", kind: "chart", report: "sales.comparison", title: "Sales by month, 3 years", span: 4 },
      { id: "monthly", kind: "table", report: "sales.net-chart", title: "Monthly totals", span: 4 },
    ],
  },
];

/** Registers the dashboard-only reports, the metrics and the four dashboards (after the report groups). */
export function registerLabDashboards(registry) {
  for (const def of LAB_DASHBOARD_REPORTS) registry.defineReport(def);
  for (const def of LAB_METRICS) registry.defineMetric(def);
  for (const def of LAB_DASHBOARDS) registry.defineDashboard(def);
}
