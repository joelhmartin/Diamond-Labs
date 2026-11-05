/**
 * Operations (10). Staff (the registry default). Five run now; Daily Tasks and
 * Production Tasks wait for piece 7's workflows, Pan Numbers for piece 6, Pick
 * Ups and Deliveries for piece 8 (registered with `requires`, dependent.js).
 * Orders are lab orders; days are lab-local; no report selects a patient,
 * the Rx form, or a free-text note.
 */
import { sql } from "drizzle-orm";
import { CARRIERS, CARRIER_LABELS, SHIPMENT_STATUS_LABELS, daysBetween } from "@my-app/shared";
import { labOrders, rxCases, rxCaseFiles, shipments } from "../../../db/schema/index.js";
import {
  ORDER_LINK, clientName, isLiveOrder, labDayBetween, labDayText, labToday, num, orderAndPage, rowsOf,
} from "./lab-metrics.js";
import {
  assigneeName, departmentName, isOpenOrder, orderJoins, ordersByDay, shippedByDay, statusBadge,
} from "./order-metrics.js";
import { dependentReport } from "./dependent.js";

const GROUP = "operations";
const RANGE = { name: "range", label: "Dates", type: "dateRange", default: "last30", maxDays: 1100 };
const ORDER_COL = { id: "orderNumber", label: "Order #", type: "text", link: ORDER_LINK };
const int = (id, label) => ({ id, label, type: "int" });
const share = (part, whole) => (whole ? part / whole : 0);
const sumOf = (rows, k) => rows.reduce((s, r) => s + (r[k] ?? 0), 0);
const sums = (rows, ids) => Object.fromEntries(ids.map((id) => [id, sumOf(rows, id)]));

// ── Case Submission ──────────────────────────────────────────────────────

/** The case came in digitally: a records method was chosen, or a scan file was uploaded. */
const hasDigitalRecords = sql`(coalesce(${rxCases.recordsMethod}, '') <> '' or exists (select 1 from ${rxCaseFiles} where ${rxCaseFiles.caseId} = ${rxCases.id} and ${rxCaseFiles.kind} = 'scan'))`;

const caseSubmission = {
  key: "operations.case-submission", group: GROUP, featured: true, title: "Case Submission",
  description: "Cases received per day, digital (a records method or a scan file) vs. physical. Shop and imported orders have no Rx case, so they count as unknown. Remakes and cancelled orders are not counted.",
  params: [RANGE],
  columns: [
    { id: "day", label: "Day", type: "date" }, int("digital", "Digital"), int("physical", "Physical"), int("unknown", "Unknown"),
    int("total", "Total"), { id: "digitalShare", label: "Digital share", type: "pct" },
  ],
  chart: {
    type: "stackedBar", x: "day",
    series: [{ field: "digital", label: "Digital" }, { field: "physical", label: "Physical" }, { field: "unknown", label: "Unknown" }],
  },
  async run(tx, { range }) {
    const raw = await rowsOf(tx, sql`
      select ${labDayText(labOrders.receivedAt)} as "day",
        count(*) filter (where ${rxCases.id} is not null and ${hasDigitalRecords}) as "digital",
        count(*) filter (where ${rxCases.id} is not null and not ${hasDigitalRecords}) as "physical",
        count(*) filter (where ${rxCases.id} is null) as "unknown"
      from ${labOrders}
      left join ${rxCases} on ${labOrders.source} = 'rx_case' and ${rxCases.id} = ${labOrders.sourceId}
      where ${isLiveOrder} and ${labOrders.isRemake} = false and ${labDayBetween(labOrders.receivedAt, range)}
      group by 1 order by 1`);
    const byDay = new Map(raw.map((r) => [String(r.day), r]));
    const shaped = (day, r = {}) => {
      const digital = num(r.digital);
      const physical = num(r.physical);
      const unknown = num(r.unknown);
      return { day, digital, physical, unknown, total: digital + physical + unknown, digitalShare: share(digital, digital + physical) };
    };
    const rows = daysBetween(range.from, range.to).map((day) => shaped(day, byDay.get(day)));
    const totals = sums(rows, ["digital", "physical", "unknown"]);
    return { rows, summary: { ...shaped("Total", totals) } };
  },
};

// ── Daily Orders / Daily Shipments ───────────────────────────────────────

const dailyOrders = {
  key: "operations.daily-orders", group: GROUP, title: "Daily Orders",
  description: "Orders received per day, with units, rush orders and remakes. Cancelled orders are not counted.",
  params: [RANGE],
  columns: [{ id: "day", label: "Day", type: "date" }, int("orders", "Orders"), int("units", "Units"), int("rush", "Rush"), int("remakes", "Remakes")],
  chart: { type: "bar", x: "day", series: [{ field: "orders", label: "Orders" }] },
  async run(tx, { range }) {
    const rows = await ordersByDay(tx, range);
    return { rows, summary: { day: "Total", ...sums(rows, ["orders", "units", "rush", "remakes"]) } };
  },
};

const CARRIER_COLS = CARRIERS.map((c) => int(c, CARRIER_LABELS[c] ?? c));

const dailyShipments = {
  key: "operations.daily-shipments", group: GROUP, title: "Daily Shipments",
  description: "Orders shipped per day and the shipments that carried them, by carrier. Orders shipped with no shipment record (imported history) are counted separately.",
  params: [RANGE],
  columns: [
    { id: "day", label: "Day", type: "date" }, int("orders", "Orders shipped"), int("shipments", "Shipments"),
    ...CARRIER_COLS, int("noShipment", "No shipment record"),
  ],
  chart: { type: "stackedBar", x: "day", series: CARRIERS.map((c) => ({ field: c, label: CARRIER_LABELS[c] ?? c })) },
  async run(tx, { range }) {
    const rows = await shippedByDay(tx, range);
    return { rows, summary: { day: "Total", ...sums(rows, ["orders", "shipments", ...CARRIERS, "noShipment"]) } };
  },
};

// ── Shipping (server paged) ──────────────────────────────────────────────

const shipping = {
  key: "operations.shipping", group: GROUP, title: "Shipping", paging: "server",
  description: "Every shipment created in the range (bought labels and recorded hand-offs; voided labels are left out): carrier, service, tracking, charge and the orders it carried.",
  params: [RANGE],
  columns: [
    { id: "created", label: "Created", type: "date" }, { id: "shipped", label: "Shipped", type: "date" },
    { id: "carrier", label: "Carrier", type: "text" }, { id: "service", label: "Service", type: "text" },
    { id: "tracking", label: "Tracking", type: "text" }, { id: "status", label: "Status", type: "badge" },
    { id: "charge", label: "Charge", type: "money" }, int("orders", "Orders"),
    { id: "orderNumbers", label: "Order #s", type: "text", sortable: false },
  ],
  async run(tx, { range }, _actor, ctx) {
    const where = sql`where ${labDayBetween(shipments.purchasedAt, range)} and ${shipments.status} <> 'voided'`;
    const sorts = {
      created: shipments.purchasedAt, shipped: shipments.shippedAt, carrier: shipments.carrier, service: shipments.serviceName,
      tracking: shipments.trackingNumber, status: shipments.status, charge: shipments.chargeCents, orders: sql`o.orders`,
    };
    const [count] = await rowsOf(tx, sql`select count(*) as "total" from ${shipments} ${where}`);
    const raw = await rowsOf(tx, sql`
      select ${shipments.id} as "id", ${labDayText(shipments.purchasedAt)} as "createdDay", ${labDayText(shipments.shippedAt)} as "shippedDay",
        ${shipments.carrier} as "carrier", ${shipments.serviceName} as "serviceName", ${shipments.trackingNumber} as "trackingNumber",
        ${shipments.status} as "status", ${shipments.chargeCents} as "chargeCents", o.orders as "orders", o.order_numbers as "orderNumbers"
      from ${shipments}
      left join lateral (
        select count(*) as orders, string_agg(${labOrders.orderNumber}::text, ', ' order by ${labOrders.orderNumber}) as order_numbers
        from ${labOrders} where ${labOrders.shipmentId} = ${shipments.id}
      ) o on true
      ${where}
      ${orderAndPage(ctx?.page, sorts, { id: "created", desc: true }, shipments.id)}`);
    const rows = raw.map((r) => ({
      id: r.id, created: r.createdDay, shipped: r.shippedDay ?? null, carrier: CARRIER_LABELS[r.carrier] ?? r.carrier,
      service: r.serviceName ?? null, tracking: r.trackingNumber ?? null,
      status: { value: r.status, label: SHIPMENT_STATUS_LABELS[r.status] ?? r.status },
      charge: r.chargeCents == null ? null : num(r.chargeCents), orders: num(r.orders), orderNumbers: r.orderNumbers ?? null,
    }));
    return { rows, total: num(count?.total) };
  },
};

// ── TBD Orders ───────────────────────────────────────────────────────────

const tbdOrders = {
  key: "operations.tbd-orders", group: GROUP, title: "TBD Orders",
  description: "Open orders with no due date yet, oldest first.",
  params: [],
  columns: [
    ORDER_COL, { id: "client", label: "Client", type: "text" }, { id: "status", label: "Status", type: "badge" },
    { id: "received", label: "Received", type: "date" }, int("daysOpen", "Days open"),
    { id: "department", label: "Department", type: "text" }, { id: "assignee", label: "Assigned to", type: "text" },
    { id: "rush", label: "Rush", type: "text" },
  ],
  async run(tx, _params, _actor, ctx) {
    const today = labToday(ctx);
    const raw = await rowsOf(tx, sql`
      select ${labOrders.id} as "labOrderId", ${labOrders.orderNumber} as "orderNumber", ${labDayText(labOrders.receivedAt)} as "receivedDay",
        ${clientName} as "client", ${labOrders.status} as "status", ${departmentName} as "department", ${assigneeName} as "assignee",
        ${labOrders.rush} as "rush"
      from ${labOrders} ${orderJoins}
      where ${isOpenOrder} and ${labOrders.dueDate} is null
      order by ${labOrders.receivedAt}, ${labOrders.id}`);
    const rows = raw.map((r) => ({
      labOrderId: r.labOrderId, orderNumber: r.orderNumber, client: r.client ?? null, status: statusBadge(r.status),
      received: r.receivedDay, daysOpen: r.receivedDay ? Math.max(0, daysBetween(r.receivedDay, today).length - 1) : null,
      department: r.department, assignee: r.assignee, rush: r.rush ? "Rush" : "",
    }));
    return { rows };
  },
};

// ── Dependent (Task 10 fills these in) ───────────────────────────────────

const STAGE_COLS = [
  ORDER_COL, { id: "client", label: "Client", type: "text" }, { id: "stage", label: "Stage", type: "text" },
  { id: "department", label: "Department", type: "text" }, { id: "assignee", label: "Assigned to", type: "text" },
  { id: "target", label: "Stage target", type: "date" }, { id: "dueDate", label: "Due", type: "date" },
];

const dependents = [
  dependentReport({
    key: "operations.daily-tasks", group: GROUP, title: "Daily Tasks", requires: ["workflows"],
    description: "Workflow stage targets falling on a day, with the order, stage, department and who it is assigned to.",
    params: [{ name: "day", label: "Day (blank = today)", type: "date" }],
    columns: STAGE_COLS,
  }),
  dependentReport({
    key: "operations.production-tasks", group: GROUP, title: "Production Tasks", requires: ["workflows"],
    description: "Open orders by their current workflow stage against the stage's target date, latest first.",
    params: [],
    columns: [...STAGE_COLS, int("daysBehind", "Days behind")],
  }),
  dependentReport({
    key: "operations.pan-numbers", group: GROUP, title: "Pan Numbers", requires: ["pan-numbers"],
    description: "Orders with their pan number, status and due date.",
    params: [{ name: "openOnly", label: "Open orders only", type: "toggle", default: true }],
    columns: [
      { id: "pan", label: "Pan", type: "text" }, ORDER_COL, { id: "client", label: "Client", type: "text" },
      { id: "status", label: "Status", type: "badge" }, { id: "dueDate", label: "Due", type: "date" },
    ],
  }),
  dependentReport({
    key: "operations.pickups", group: GROUP, title: "Pick Ups", requires: ["pickups"],
    description: "Pickups by date and status.",
    params: [RANGE],
    columns: [
      { id: "day", label: "Day", type: "date" }, { id: "client", label: "Client", type: "text" },
      { id: "status", label: "Status", type: "badge" }, int("orders", "Orders"),
    ],
  }),
  dependentReport({
    key: "operations.deliveries", group: GROUP, title: "Deliveries", requires: ["deliveries"],
    description: "Local delivery routes by date: each stop, its client and status.",
    params: [RANGE],
    columns: [
      { id: "day", label: "Day", type: "date" }, { id: "route", label: "Route", type: "text" }, int("stop", "Stop"),
      { id: "client", label: "Client", type: "text" }, { id: "status", label: "Status", type: "badge" }, int("orders", "Orders"),
    ],
  }),
];

export const OPERATIONS_REPORTS = [caseSubmission, dailyOrders, dailyShipments, shipping, tbdOrders, ...dependents];

export function registerOperationsReports(registry) {
  for (const def of OPERATIONS_REPORTS) registry.defineReport(def);
}
