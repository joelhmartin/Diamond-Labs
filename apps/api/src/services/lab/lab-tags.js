import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../config/database.js";
import { labOrders, labOrderEvents, users } from "../../db/schema/index.js";
import { sealEvent } from "./lab-order-crypto.js";

/**
 * Lab orders as a record-tags / record-files record type ("lab_order"): the
 * one place the generic modules learn which ids exist and what happens when an
 * order's labels change. Used by the desk routes and by staff order entry.
 */
export const LAB_ORDER_RECORD_TYPE = "lab_order";

/**
 * A client's sales rep, as a record-tags record type: each tag in this
 * vocabulary names a rep, and tagging a client (a doctor user's id) with one
 * assigns them (Sales By Rep reads it). Its own vocabulary, so rep names never
 * mix with any other client label. Admins define the reps; staff apply them.
 */
export const CLIENT_REP_RECORD_TYPE = "client_rep";

/** The ids (of `ids`) that are clients (doctor users). */
export async function clientIdsThatExist(ids, database = db) {
  if (!ids.length) return new Set();
  const rows = await database.select({ id: users.id }).from(users).where(and(inArray(users.id, ids), eq(users.role, "doctor")));
  return new Set(rows.map((r) => r.id));
}

/** The ids (of `ids`) that are lab orders. Pass the transaction to see an order created in it. */
export async function labOrderIdsThatExist(ids, database = db) {
  if (!ids.length) return new Set();
  const rows = await database.select({ id: labOrders.id }).from(labOrders).where(inArray(labOrders.id, ids));
  return new Set(rows.map((r) => r.id));
}

const EVENT_TO_MAX = 128; // lab_order_events.to_value

/**
 * Called by record-tags in the same transaction as a label change: one `label`
 * event per order and label actually added or removed (a no-op apply has no
 * changes, so writes none). Labels never bump the order's version.
 */
export async function onLabOrderTagsChanged(tx, changes, { byUserId = null } = {}) {
  const base = Date.now();
  const events = [];
  for (const c of changes) {
    const event = (verb) => (tag) => ({ labOrderId: c.recordId, type: "label", from: null, to: String(tag.label).slice(0, EVENT_TO_MAX), byUserId, note: `Label ${verb}` });
    events.push(...c.added.map(event("added")), ...c.removed.map(event("removed")));
  }
  if (!events.length) return;
  // Distinct timestamps keep the timeline in the order the changes were made.
  await tx.insert(labOrderEvents).values(events.map((e, i) => sealEvent({ ...e, at: new Date(base + i) })));
}
