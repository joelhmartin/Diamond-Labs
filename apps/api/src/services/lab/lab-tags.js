import { inArray } from "drizzle-orm";
import { db } from "../../config/database.js";
import { labOrders } from "../../db/schema/index.js";

/**
 * Lab orders as a record-tags / record-files record type ("lab_order"): the
 * one place the generic modules learn which ids exist and what happens when an
 * order's labels change. Used by the desk routes and by staff order entry.
 */
export const LAB_ORDER_RECORD_TYPE = "lab_order";

/** The ids (of `ids`) that are lab orders. Pass the transaction to see an order created in it. */
export async function labOrderIdsThatExist(ids, database = db) {
  if (!ids.length) return new Set();
  const rows = await database.select({ id: labOrders.id }).from(labOrders).where(inArray(labOrders.id, ids));
  return new Set(rows.map((r) => r.id));
}

/**
 * Called by record-tags in the same transaction as a label change. A no-op
 * for now; Task 8 records it as a `label` event (tags never bump the version).
 */
// eslint-disable-next-line no-unused-vars
export async function onLabOrderTagsChanged(tx, changes) {}
