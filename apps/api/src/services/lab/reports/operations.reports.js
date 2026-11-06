/**
 * Operations (10). Staff (the registry default). Daily Tasks, Production
 * Tasks, Pan Numbers, Pick Ups and Deliveries read the later pieces' desk
 * data (operations-desk.reports.js). Orders are lab orders; days are
 * lab-local; no report selects a patient, the Rx form, or a free-text note.
 */
import { sql } from "drizzle-orm";
import { CARRIERS, CARRIER_LABELS, SHIPMENT_STATUS_LABELS, daysBetween, daysInRange } from "@my-app/shared";
import { labOrders, rxCases, rxCaseFiles, shipments, intakes } from "../../../db/schema/index.js";
import { LAB_ORDER_RECORD_TYPE } from "../lab-tags.js";
import {
  ORDER_LINK, clientName, isLiveOrder, labDayBetween, labDayText, labToday, num, orderAndPage, rowsOf,
} from "./lab-metrics.js";
import {
  assigneeName, departmentName, isOpenOrder, orderJoins, ordersByDay, shippedByDay, statusBadge,
} from "./order-metrics.js";
import { OPERATIONS_DESK_REPORTS } from "./operations-desk.reports.js";
import { int, share, sumOf, sums } from "./report-helpers.js";

const GROUP = "operations";
const RANGE = { name: "range", label: "Dates", type: "dateRange", default: "last30", maxDays: 1100 };
const ORDER_COL = { id: "orderNumber", label: "Order #", type: "text", link: ORDER_LINK };

// ── Case Submission ──────────────────────────────────────────────────────

/**
 * The case came in digitally: its Rx case names a records method or has a scan
 * file, or (piece 6) a scanner-export drop was turned into the order (an
 * intake promoted onto it).
 */
const fromScannerExport = sql`exists (select 1 from ${intakes} where ${intakes.promotedRecordType} = ${LAB_ORDER_RECORD_TYPE} and ${intakes.promotedRecordId} = ${labOrders.id})`;
const hasDigitalRecords = sql`(coalesce(${rxCases.recordsMethod}, '') <> '' or exists (select 1 from ${rxCaseFiles} where ${rxCaseFiles.caseId} = ${rxCases.id} and ${rxCaseFiles.kind} = 'scan') or ${fromScannerExport})`;
/**
 * The case came in physically: an Rx case with no digital records, or (piece 6)
 * staff recorded items enclosed with it. Only whether the enclosures column is
 * set is read (an empty list is stored as null); the sealed list is never selected.
 */
const hasPhysicalItems = sql`(${rxCases.id} is not null or ${labOrders.enclosures} is not null)`;

const caseSubmission = {
  key: "operations.case-submission", group: GROUP, featured: true, title: "Case Submission",
  description: "Cases received per day, digital (a records method, a scan file or a scanner-export drop turned into the order) vs. physical (an Rx case with no digital records, or items recorded as enclosed). Orders with neither (shop and imported orders) count as unknown. Remakes and cancelled orders are not counted.",
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
        count(*) filter (where ${hasDigitalRecords}) as "digital",
        count(*) filter (where not ${hasDigitalRecords} and ${hasPhysicalItems}) as "physical",
        count(*) filter (where not ${hasDigitalRecords} and not ${hasPhysicalItems}) as "unknown"
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
    const rows = daysInRange(range.from, range.to).map((day) => shaped(day, byDay.get(day)));
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
      received: r.receivedDay, daysOpen: r.receivedDay ? Math.max(0, daysBetween(r.receivedDay, today)) : null,
      department: r.department, assignee: r.assignee, rush: r.rush ? "Rush" : "",
    }));
    return { rows };
  },
};

export const OPERATIONS_REPORTS = [caseSubmission, dailyOrders, dailyShipments, shipping, tbdOrders, ...OPERATIONS_DESK_REPORTS];

export function registerOperationsReports(registry) {
  for (const def of OPERATIONS_REPORTS) registry.defineReport(def);
}
