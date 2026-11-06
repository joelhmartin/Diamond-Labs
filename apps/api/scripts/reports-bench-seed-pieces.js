/**
 * The later pieces' synthetic data for the reports bench: workflow plans
 * (piece 7), pan numbers, materials, remake reasons, labels and intakes
 * (piece 6), pickups and local-delivery orders (piece 8), client rep tags and
 * price lists (piece 10). Everything is invented: no notes, no addresses on
 * pickups, no sealed column (enclosures, hints, cancel reasons) is ever set.
 *
 * The calendar row, the eight workflows and the adjustment reasons come from
 * the app's own seed migrations (0036, 0039); this module only reads them by
 * their fixed ids and turns capacity on so the calendar report has a load.
 *
 * addPieceRows(r, plan, now) is pure: it sets fields on plan.orders and returns
 * the extra rows keyed by table. PIECE_TABLES lists them in insert order.
 */
import { eq } from "drizzle-orm";
import { addDays, isoDateIn, LAB_TIMEZONE } from "@my-app/shared";
import * as schema from "../src/db/schema/index.js";
import { toCalendar } from "../src/modules/business-calendar/index.js";
import { planWith } from "../src/modules/workflows/index.js";

const pad = (n, w) => String(n).padStart(w, "0");
const DAY_MS = 86400000;
/** The bench calendar: the migration's row with weekday unit capacity turned on. */
export const BENCH_CALENDAR = {
  key: "default", timezone: LAB_TIMEZONE, leadDays: 13, closedWeekdays: [0, 6],
  capacityBasis: "units", capacityByWeekday: { 1: 60, 2: 60, 3: 60, 4: 60, 5: 50 },
};
/** One of the seeded workflows (0036), copied as a template planWith can use. */
const TEMPLATE = {
  key: "10d-printed", name: "10-day Printed", totalDays: 10, rushWorkflowKey: null, isDefault: false, active: true,
  stages: [
    { key: "check-in", label: "Check in", dayOffset: 0, milestone: "received" },
    { key: "production", label: "Production", dayOffset: 1, milestone: "in_production" },
    { key: "qc", label: "Quality check", dayOffset: 8, milestone: "quality_check" },
    { key: "pack", label: "Pack", dayOffset: 9, milestone: "ready_to_ship" },
    { key: "ship", label: "Ship", dayOffset: 10, milestone: "shipped" },
  ],
};
const REMAKE_REASONS = ["reason_remake_lab_error", "reason_remake_change_of_occlusion", "reason_remake_client_patient_error"];
const MATERIALS = ["PMMA puck", "Dual laminate sheet", "Printed resin", "Hard acrylic", "Soft liner"];
const REPS = ["Rep North", "Rep South", "Rep East", "Rep West"];
const ORDER_LABELS = ["Rush review", "Call doctor", "Waiting on scan"];

function plans(r, orders, now) {
  const calendar = toCalendar(BENCH_CALENDAR);
  const since = new Date(now.getTime() - 45 * DAY_MS);
  return orders
    .filter((o) => o.source !== "legacy" && o.status !== "cancelled" && o.receivedAt >= since)
    .map((o) => {
      const plan = planWith({ [TEMPLATE.key]: TEMPLATE }, { workflowKey: TEMPLATE.key, startAt: o.receivedAt }, calendar);
      return {
        recordType: "lab_order", recordId: o.id, workflowKey: plan.workflowKey, workflowName: plan.workflowName,
        startDate: plan.startDate, dueDate: plan.dueAt, direction: plan.direction, stages: plan.stages,
        createdAt: o.receivedAt, updatedAt: o.receivedAt,
      };
    });
}

function orderFields(r, orders, orderLines) {
  const linesByOrder = new Map(orderLines.map((l) => [l.labOrderId, l]));
  const materials = [];
  for (const [i, o] of orders.entries()) {
    if (o.source === "legacy") continue;
    if (r.chance(0.7)) o.panNumber = `P-${pad(1 + (i % 400), 3)}`;
    if (o.clientUserId && r.chance(0.15)) o.deliveryMethod = "local_delivery";
    if (o.isRemake) o.remakeReasonId = r.chance(0.8) ? r.pick(REMAKE_REASONS) : null;
    const line = linesByOrder.get(o.id);
    if (line && r.chance(0.5)) {
      materials.push({
        id: `bench-material-${pad(materials.length + 1, 6)}`, labOrderId: o.id, labOrderLineId: line.id, position: 0,
        material: r.pick(MATERIALS), lotNumber: `LOT-${pad(r.int(1, 999), 3)}`, createdAt: o.receivedAt,
      });
    }
  }
  return materials;
}

function pickups(r, clients, now) {
  const today = isoDateIn(LAB_TIMEZONE, now);
  return Array.from({ length: 1500 }, (_, i) => {
    const c = r.pick(clients);
    const earliest = addDays(today, r.int(-300, 20));
    const status = earliest > today ? r.pick(["requested", "scheduled"]) : r.weighted([["completed", 8], ["cancelled", 1], ["scheduled", 1]]);
    return {
      id: `bench-pickup-${pad(i + 1, 5)}`, pickupNumber: 1 + i, clientUserId: c.id, partyKey: `user:${c.id}`,
      requestedByUserId: c.id, earliestDate: earliest, latestDate: addDays(earliest, 2),
      timePreference: r.pick(["am", "pm", "any"]), boxCount: r.int(1, 4), status,
      scheduledDate: status === "requested" ? null : addDays(earliest, 1),
      completedAt: status === "completed" ? new Date(`${addDays(earliest, 1)}T20:00:00Z`) : null,
      cancelledAt: status === "cancelled" ? new Date(`${earliest}T15:00:00Z`) : null,
      source: "portal", createdAt: new Date(`${earliest}T12:00:00Z`),
    };
  });
}

function tagRows(r, clients, orders) {
  const defs = [
    ...REPS.map((label, i) => ({ id: `bench-rep-${i + 1}`, recordType: "client_rep", label, position: i })),
    ...ORDER_LABELS.map((label, i) => ({ id: `bench-label-${i + 1}`, recordType: "lab_order", label, position: i })),
  ];
  const tags = [];
  const tag = (recordType, recordId, tagId) => tags.push({ id: `bench-rtag-${pad(tags.length + 1, 6)}`, recordType, recordId, tagId });
  for (const c of clients) if (r.chance(0.8)) tag("client_rep", c.id, `bench-rep-${r.int(1, REPS.length)}`);
  for (const o of orders) if (o.source !== "legacy" && r.chance(0.05)) tag("lab_order", o.id, `bench-label-${r.int(1, ORDER_LABELS.length)}`);
  return { tagDefinitions: defs, recordTags: tags };
}

function priceListRows(r, clients, productVariants) {
  const priceLists = ["Gold", "Silver", "Study club", "Retired 2024"].map((name, i) => ({
    id: `bench-plist-${i + 1}`, name, archivedAt: i === 3 ? new Date("2025-01-01T00:00:00Z") : null,
  }));
  const priceListItems = priceLists.flatMap((l, li) => productVariants.filter((_, vi) => (vi + li) % 3 !== 0).map((v) => ({
    id: `bench-pitem-${li + 1}-${v.id}`, priceListId: l.id, variantId: v.id, priceCents: Math.round(v.basePriceCents * (0.8 + li * 0.05)),
  })));
  const clientPriceLists = clients.filter(() => r.chance(0.4)).map((c, i) => ({
    id: `bench-cplist-${pad(i + 1, 4)}`, clientUserId: c.id, priceListId: priceLists[r.int(0, 2)].id, position: 0,
  }));
  return { priceLists, priceListItems, clientPriceLists };
}

function intakeRows(r, orders) {
  return orders.filter((o) => o.source === "rx_case" && r.chance(0.1)).map((o, i) => ({
    id: `bench-intake-${pad(i + 1, 5)}`, channel: "upload", status: "promoted", parserKey: "generic",
    promotedRecordType: "lab_order", promotedRecordId: o.id, createdAt: o.receivedAt, decidedAt: o.receivedAt,
  }));
}

/** The later pieces' rows (and the order fields they need), from the base plan. */
export function addPieceRows(r, plan, now) {
  const labOrderLineMaterials = orderFields(r, plan.orders, plan.orderLines);
  return {
    labOrderLineMaterials, workflowPlans: plans(r, plan.orders, now), pickups: pickups(r, plan.clients, now),
    ...tagRows(r, plan.clients, plan.orders), ...priceListRows(r, plan.clients, plan.productVariants),
    intakes: intakeRows(r, plan.orders),
  };
}

/** Plan key → drizzle table for the rows above, inserted after the base tables. */
export const PIECE_TABLES = [
  ["labOrderLineMaterials", schema.labOrderLineMaterials], ["workflowPlans", schema.workflowPlans], ["pickups", schema.pickups],
  ["tagDefinitions", schema.tagDefinitions], ["recordTags", schema.recordTags], ["priceLists", schema.priceLists],
  ["priceListItems", schema.priceListItems], ["clientPriceLists", schema.clientPriceLists], ["intakes", schema.intakes],
];

/** Turn unit capacity on for the migration's calendar row (bench database only). */
export async function enableBenchCapacity(db) {
  const { key, ...set } = BENCH_CALENDAR;
  await db.update(schema.calendars).set(set).where(eq(schema.calendars.key, key));
}
