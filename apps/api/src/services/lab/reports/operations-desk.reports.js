/**
 * Operations reports over the later pieces' desk data (Operations group):
 * Daily Tasks and Production Tasks read piece 7's workflow stage targets
 * (stage-targets.js), Pan Numbers piece 6's pan column, Pick Ups piece 8's
 * pickups table and Deliveries piece 8's local-delivery route list
 * (deliveries.service listStops, run in the report's transaction). Staff.
 *
 * No PHI and no free text: pickup notes and cancel reasons, the practice's
 * delivery notes and every patient or note column are never selected. A
 * practice's business address is shown on the route list (where the driver
 * goes); a patient address never exists here.
 */
import { sql } from "drizzle-orm";
import { PICKUP_STATUS_LABELS, TIME_PREFERENCE_LABELS } from "@my-app/shared";
import { labOrders, pickups, users } from "../../../db/schema/index.js";
import { businessDaysBetween } from "../../../modules/business-calendar/index.js";
import { ReportError } from "../../../modules/reports/runner.js";
import { listStops } from "../deliveries.service.js";
import { LabOrderError } from "../lab-order-rules.js";
import {
  ORDER_LINK, clientName, labCalendar, labToday, num, orderAndPage, rowsOf,
} from "./lab-metrics.js";
import { isOpenOrder, statusBadge } from "./order-metrics.js";
import { PRACTICE_PARAMS, andPractice, optionalClientJoin, int, sumOf, sums } from "./report-helpers.js";
import { plannedOrders, stageTargets, taskRow } from "./stage-targets.js";

const GROUP = "operations";
const ORDER_COL = { id: "orderNumber", label: "Order #", type: "text", link: ORDER_LINK };
const STAGE_COLS = [
  ORDER_COL, { id: "client", label: "Client", type: "text" }, { id: "stage", label: "Stage", type: "text" },
  { id: "department", label: "Department", type: "text" }, { id: "assignee", label: "Assigned to", type: "text" },
  { id: "target", label: "Stage target", type: "date" }, { id: "dueDate", label: "Due", type: "date" },
];

// ── Daily Tasks / Production Tasks (piece 7) ─────────────────────────────

const dailyTasks = {
  key: "operations.daily-tasks", group: GROUP, title: "Daily Tasks", requires: ["workflows"],
  description: "Workflow stage targets falling on a day, with the order, stage, department, who it is assigned to and whether the stage is done.",
  params: [{ name: "day", label: "Day (blank = today)", type: "date" }],
  columns: [...STAGE_COLS, { id: "state", label: "Done?", type: "badge" }, { id: "status", label: "Order status", type: "badge" }],
  async run(tx, params, _actor, ctx) {
    const today = labToday(ctx);
    const day = params?.day || today;
    const range = { from: day, to: day };
    const targets = stageTargets(await plannedOrders(tx, { range }), today, await labCalendar(tx), range);
    const rows = targets.sort((a, b) => a.position - b.position || a.orderNumber - b.orderNumber).map(taskRow);
    return { rows, notice: `Stage targets on ${day}.` };
  },
};

const productionTasks = {
  key: "operations.production-tasks", group: GROUP, title: "Production Tasks", requires: ["workflows"],
  description: "Open orders at their current workflow stage (the first not yet reached) against that stage's target, most behind first. Days behind are business days.",
  params: [],
  columns: [...STAGE_COLS, int("daysBehind", "Days behind"), { id: "status", label: "Order status", type: "badge" }],
  async run(tx, _params, _actor, ctx) {
    const today = labToday(ctx);
    const cal = await labCalendar(tx);
    const targets = stageTargets(await plannedOrders(tx, { openOnly: true }), today, cal);
    const current = new Map();
    for (const t of targets) if (!t.reached && !current.has(t.labOrderId)) current.set(t.labOrderId, t);
    const rows = [...current.values()]
      .map((t) => ({ ...taskRow(t), daysBehind: t.target < today ? businessDaysBetween(t.target, today, cal) : 0 }))
      .sort((a, b) => b.daysBehind - a.daysBehind || a.target.localeCompare(b.target) || a.orderNumber - b.orderNumber);
    return { rows };
  },
};

// ── Pan Numbers (piece 6) ────────────────────────────────────────────────

const panNumbers = {
  key: "operations.pan-numbers", group: GROUP, title: "Pan Numbers", paging: "server", requires: ["pan-numbers"],
  description: "Orders with a pan number, with their status and due date. Cancelled orders are not listed.",
  params: [{ name: "openOnly", label: "Open orders only", type: "toggle", default: true }, ...PRACTICE_PARAMS],
  columns: [
    { id: "pan", label: "Pan", type: "text" }, { ...ORDER_COL }, { id: "client", label: "Client", type: "text" },
    { id: "status", label: "Status", type: "badge" }, { id: "dueDate", label: "Due", type: "date" },
  ],
  async run(tx, params, _actor, ctx) {
    const parts = [sql`${labOrders.panNumber} is not null`, sql`${labOrders.status} <> 'cancelled'${andPractice(params, labOrders.accountId)}`];
    if (params?.openOnly !== false) parts.push(isOpenOrder);
    const where = sql`where ${sql.join(parts, sql` and `)}`;
    const sorts = {
      pan: labOrders.panNumber, orderNumber: labOrders.orderNumber, client: clientName, status: labOrders.status, dueDate: labOrders.dueDate,
    };
    const [count] = await rowsOf(tx, sql`select count(*) as "total" from ${labOrders} ${where}`);
    const raw = await rowsOf(tx, sql`
      select ${labOrders.id} as "labOrderId", ${labOrders.panNumber} as "pan", ${labOrders.orderNumber} as "orderNumber",
        ${clientName} as "client", ${labOrders.status} as "status", to_char(${labOrders.dueDate}, 'YYYY-MM-DD') as "dueDate"
      from ${labOrders} ${optionalClientJoin(labOrders.clientUserId)}
      ${where}
      ${orderAndPage(ctx?.page, sorts, { id: "pan", desc: false }, labOrders.id)}`);
    const rows = raw.map((r) => ({
      labOrderId: r.labOrderId, pan: r.pan, orderNumber: r.orderNumber, client: r.client ?? null, status: statusBadge(r.status), dueDate: r.dueDate ?? null,
    }));
    return { rows, total: num(count?.total) };
  },
};

// ── Pick Ups / Deliveries (piece 8) ──────────────────────────────────────

const RANGE = { name: "range", label: "Dates", type: "dateRange", default: "last30", maxDays: 1100 };
/** A pickup's day: the day it is scheduled for, else the first day of the window the practice asked for. */
const pickupDay = sql`coalesce(${pickups.scheduledDate}, ${pickups.earliestDate})`;

const pickupsReport = {
  key: "operations.pickups", group: GROUP, title: "Pick Ups", requires: ["pickups"],
  description: "Pickups by day (the scheduled day, else the first day the practice asked for) and status, with the boxes and the driver.",
  params: [RANGE, { name: "status", label: "Status", type: "multiselect", options: Object.entries(PICKUP_STATUS_LABELS).map(([value, label]) => ({ value, label })) }],
  columns: [
    { id: "day", label: "Day", type: "date" }, { id: "pickupNumber", label: "Pickup #", type: "text" },
    { id: "client", label: "Client", type: "text" }, { id: "status", label: "Status", type: "badge" },
    { id: "window", label: "Asked for", type: "text" }, { id: "time", label: "Time", type: "text" },
    int("boxes", "Boxes"), { id: "driver", label: "Driver", type: "text" },
  ],
  async run(tx, { range, status }) {
    const statuses = (status ?? []).filter((s) => Object.hasOwn(PICKUP_STATUS_LABELS, s));
    const byStatus = statuses.length ? sql` and ${pickups.status} in (${sql.join(statuses.map((s) => sql`${s}`), sql`, `)})` : sql``;
    const raw = await rowsOf(tx, sql`
      select ${pickups.id} as "pickupId", ${pickups.pickupNumber} as "pickupNumber", to_char(${pickupDay}, 'YYYY-MM-DD') as "day",
        ${clientName} as "client", ${pickups.status} as "status", to_char(${pickups.earliestDate}, 'YYYY-MM-DD') as "earliest",
        to_char(${pickups.latestDate}, 'YYYY-MM-DD') as "latest", ${pickups.timePreference} as "time", ${pickups.boxCount} as "boxes",
        driver.name as "driver"
      from ${pickups}
      ${optionalClientJoin(pickups.clientUserId)}
      left join ${users} as driver on driver.id = ${pickups.assigneeUserId}
      where ${pickupDay} between ${range.from}::date and ${range.to}::date${byStatus}
      order by 3, ${pickups.pickupNumber}`);
    const rows = raw.map((r) => ({
      pickupId: r.pickupId, pickupNumber: r.pickupNumber, day: r.day, client: r.client ?? null,
      status: { value: r.status, label: PICKUP_STATUS_LABELS[r.status] ?? r.status },
      window: r.earliest === r.latest ? r.earliest : `${r.earliest} to ${r.latest}`, time: TIME_PREFERENCE_LABELS[r.time] ?? r.time,
      boxes: num(r.boxes), driver: r.driver ?? null,
    }));
    return { rows, summary: { day: "Total", boxes: sumOf(rows, "boxes") } };
  },
};

const addressLine = (a) => (a ? [a.address1, a.address2, a.city, [a.state, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") : null);

/** listStops, with its own range refusal (INVALID) reported on the range param instead of as a 500. */
async function stopsFor(tx, range, ctx) {
  try {
    return await listStops(tx, { from: range.from, to: range.to, todayIso: labToday(ctx) });
  } catch (err) {
    if (err instanceof LabOrderError && err.code === "INVALID") throw new ReportError("INVALID", err.message, "range");
    throw err;
  }
}

const deliveries = {
  key: "operations.deliveries", group: GROUP, title: "Deliveries", requires: ["deliveries"],
  description: "The local-delivery route list by day: each stop (a practice), its orders due that day and the pickups the driver collects there. A late stop carries an order due before the range. At most 63 days.",
  params: [{ ...RANGE, default: "today", maxDays: 63 }],
  columns: [
    { id: "day", label: "Day", type: "date" }, int("stop", "Stop"), { id: "client", label: "Practice", type: "text" },
    { id: "address", label: "Address", type: "text" }, { id: "status", label: "Status", type: "badge" },
    int("orders", "Orders"), { id: "orderNumbers", label: "Order #s", type: "text", sortable: false }, int("pickups", "Pickups"), int("boxes", "Boxes"),
  ],
  async run(tx, { range }, _actor, ctx) {
    const stops = await stopsFor(tx, range, ctx);
    const perDay = new Map();
    const rows = stops.map((s) => {
      const stop = (perDay.get(s.day) ?? 0) + 1;
      perDay.set(s.day, stop);
      return {
        day: s.day, stop, client: s.practice, address: addressLine(s.address),
        status: s.late ? { value: "late", label: "Late" } : { value: "on_time", label: "On time" },
        orders: s.orders.length, orderNumbers: s.orders.map((o) => o.orderNumber).join(", "),
        pickups: s.pickups.length, boxes: s.pickups.reduce((n, p) => n + num(p.boxCount), 0),
      };
    });
    return { rows, summary: { day: "Total", ...sums(rows, ["orders", "pickups", "boxes"]) } };
  },
};

export const OPERATIONS_DESK_REPORTS = [dailyTasks, productionTasks, panNumbers, pickupsReport, deliveries];
