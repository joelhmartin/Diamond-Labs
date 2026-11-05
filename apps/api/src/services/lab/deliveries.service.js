import { and, eq, gte, inArray, isNotNull, lte, ne, or } from "drizzle-orm";
import { isoDateIn, LAB_TIMEZONE } from "@my-app/shared";
import { labOrders, users, doctorProfiles } from "../../db/schema/index.js";
import { practiceKeyFor } from "../practice.js";
import { scheduledPickupsBetween } from "./pickups.service.js";
import { addDays } from "./pickup-rules.js";
import { LabOrderError } from "./lab-order-rules.js";

/**
 * The local-delivery route list (spec "Deliveries (glue)"): one stop per
 * (day, practice) the lab's own driver visits. Day is the order's due date;
 * an open order due before `from` is carried onto `from` as late. Scheduled
 * pickups for the same practice and day join the stop, so the driver does
 * both. Order numbers, statuses and versions only: no patient field is read.
 * Pure reads; piece 9 can wrap listStops as a report.
 */

export const LOCAL_DELIVERY = "local_delivery";
const DEFAULT_SPAN_DAYS = 6;
// A route sheet is a week or two; a year-long range is a mistake, not a report.
export const MAX_SPAN_DAYS = 62;

const DAY_MS = 86_400_000;
const span = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** `{ from, to }` with the defaults filled: from = today (CT), to = from + 6. A reversed or over-long range is INVALID. */
export function deliveryRange({ from, to } = {}, todayIso) {
  const start = from || todayIso;
  const end = to || addDays(start, DEFAULT_SPAN_DAYS);
  if (end < start) throw new LabOrderError("INVALID", "The end date can't be before the start date.");
  if (span(start, end) > MAX_SPAN_DAYS) throw new LabOrderError("INVALID", `Pick a range of at most ${MAX_SPAN_DAYS} days.`);
  return { from: start, to: end };
}

/** The stop day for an order, or null when it is not on this sheet. */
function orderDay(o, { from, to }) {
  if (o.deliveryMethod !== LOCAL_DELIVERY || o.status === "cancelled" || !o.dueDate || o.dueDate > to) return null;
  if (o.status === "shipped") {
    const shipped = o.shippedAt ? isoDateIn(LAB_TIMEZONE, new Date(o.shippedAt)) : null;
    if (!shipped || shipped < from || shipped > to) return null;
  }
  return o.dueDate < from ? from : o.dueDate;
}

function loadOrders(database, { from, to }) {
  // Coarse in SQL (a day either side of the CT range), exact in orderDay().
  const shippedSince = new Date(Date.parse(`${from}T00:00:00Z`) - DAY_MS);
  return database
    .select({
      id: labOrders.id, orderNumber: labOrders.orderNumber, status: labOrders.status, version: labOrders.version,
      dueDate: labOrders.dueDate, shippedAt: labOrders.shippedAt, clientUserId: labOrders.clientUserId,
      deliveryMethod: labOrders.deliveryMethod,
    })
    .from(labOrders)
    .where(and(
      eq(labOrders.deliveryMethod, LOCAL_DELIVERY),
      ne(labOrders.status, "cancelled"),
      isNotNull(labOrders.dueDate),
      lte(labOrders.dueDate, to),
      or(ne(labOrders.status, "shipped"), gte(labOrders.shippedAt, shippedSince)),
    ));
}

function loadClients(database, ids) {
  if (ids.length === 0) return [];
  return database
    .select({
      id: users.id, seazonaClientId: users.seazonaClientId, name: users.name, companyName: doctorProfiles.companyName,
      address1: doctorProfiles.address1, address2: doctorProfiles.address2, city: doctorProfiles.city,
      state: doctorProfiles.state, zip: doctorProfiles.zip, phone: doctorProfiles.phone, deliveryNotes: doctorProfiles.deliveryNotes,
    })
    .from(users)
    .leftJoin(doctorProfiles, eq(doctorProfiles.userId, users.id))
    .where(inArray(users.id, ids));
}

function newStop(day, partyKey, c) {
  return {
    id: `${day}:${partyKey}`, day, late: false,
    practice: c?.companyName || c?.name || "—",
    address: c ? { address1: c.address1 ?? null, address2: c.address2 ?? null, city: c.city ?? null, state: c.state ?? null, zip: c.zip ?? null } : null,
    phone: c?.phone ?? null, deliveryNotes: c?.deliveryNotes ?? null,
    orders: [], pickups: [],
  };
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * → `[{ id: "<day>:<partyKey>", day, late, practice, address, phone, deliveryNotes,
 *       orders: [{ id, orderNumber, status, version }], pickups: [{ id, pickupNumber, boxCount, version }] }]`,
 * sorted by day, then practice. `from`/`to` default through deliveryRange().
 */
export async function listStops(database, { from, to, todayIso = isoDateIn(LAB_TIMEZONE) } = {}) {
  const range = deliveryRange({ from, to }, todayIso);
  const orders = (await loadOrders(database, range)).map((o) => ({ ...o, day: orderDay(o, range) })).filter((o) => o.day);
  const pickups = await scheduledPickupsBetween(database, range.from, range.to);
  const ids = [...new Set([...orders, ...pickups].map((r) => r.clientUserId).filter(Boolean))];
  const clients = new Map((await loadClients(database, ids)).map((c) => [c.id, c]));

  const stops = new Map();
  const stopFor = (day, partyKey, clientUserId) => {
    const key = `${day}:${partyKey}`;
    if (!stops.has(key)) stops.set(key, newStop(day, partyKey, clients.get(clientUserId)));
    return stops.get(key);
  };
  for (const o of orders) {
    const c = clients.get(o.clientUserId);
    // A guest order (no client) is a stop of its own rather than sharing one "nobody" practice.
    const partyKey = o.clientUserId ? practiceKeyFor(c ?? { id: o.clientUserId }) : `order:${o.id}`;
    const stop = stopFor(o.day, partyKey, o.clientUserId);
    if (o.status !== "shipped" && o.dueDate < range.from) stop.late = true;
    stop.orders.push({ id: o.id, orderNumber: o.orderNumber, status: o.status, version: o.version });
  }
  for (const p of pickups) {
    stopFor(p.scheduledDate, p.partyKey, p.clientUserId)
      .pickups.push({ id: p.id, pickupNumber: p.pickupNumber, boxCount: p.boxCount, version: p.version });
  }

  const out = [...stops.values()];
  for (const s of out) {
    s.orders.sort((a, b) => a.orderNumber - b.orderNumber);
    s.pickups.sort((a, b) => a.pickupNumber - b.pickupNumber);
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || collator.compare(a.practice, b.practice) || a.id.localeCompare(b.id));
}
