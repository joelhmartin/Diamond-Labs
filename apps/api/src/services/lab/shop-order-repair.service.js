import { and, asc, eq, inArray, lt, gte, sql } from "drizzle-orm";
import { db } from "../../config/database.js";
import { env } from "../../config/env.js";
import { orders, orderItems, labOrders, productVariants } from "../../db/schema/index.js";
import { toCents } from "../../lib/money.js";
import { createShopLabOrder } from "./lab-orders.service.js";

/**
 * Repair sweep for paid shop orders that never got their lab order and paid
 * invoice. Checkout creates those in a transaction AFTER the paid order
 * commits (a failure there is logged [LAB][SHOP_ORDER_FAILED] and a replay of
 * the same Idempotency-Key returns the cached result), so the paid `orders`
 * row is the durable record and this query is the reconciliation item.
 */

const SWEEP_LIMIT = 200;

/**
 * The stored order → the quote shape createShopLabOrder reads. The inverse of
 * what checkout writes into orders / order_items (cents ← numeric dollars).
 * A line without a variantId predates own-the-lab piece 2: returns null (never
 * invent a job for history).
 */
export function quoteFromStoredOrder(order, items, codeByVariantId = new Map()) {
  if (!items.length || items.some((i) => !i.variantId)) return null;
  return {
    lines: items.map((i) => ({
      variantId: i.variantId, code: codeByVariantId.get(i.variantId) ?? null, name: i.name, qty: i.qty,
      unitCents: toCents(i.unitPrice), lineCents: toCents(i.lineTotal), taxable: i.taxable, priceSource: i.priceSource ?? "base",
    })),
    subtotalCents: toCents(order.subtotal), taxCents: toCents(order.tax),
    shippingCents: toCents(order.shippingCost), totalCents: toCents(order.total),
  };
}

/** One order, in its own transaction; re-checks under a row lock so a concurrent sweep or checkout can't double-create. */
async function repairOne(tx, order) {
  await tx.select({ id: orders.id }).from(orders).where(eq(orders.id, order.id)).for("update");
  const [existing] = await tx.select({ id: labOrders.id }).from(labOrders)
    .where(and(eq(labOrders.source, "shop_order"), eq(labOrders.sourceId, order.id), eq(labOrders.isRemake, false)));
  if (existing) return "alreadyHasLabOrder";
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id)).orderBy(asc(orderItems.createdAt));
  const variantIds = [...new Set(items.map((i) => i.variantId).filter(Boolean))];
  const variants = variantIds.length
    ? await tx.select({ id: productVariants.id, code: productVariants.code }).from(productVariants).where(inArray(productVariants.id, variantIds))
    : [];
  const quote = quoteFromStoredOrder(order, items, new Map(variants.map((v) => [v.id, v.code])));
  if (!quote) return "preLabOrders";
  await createShopLabOrder(tx, { orderId: order.id, clientUserId: order.pricedForUserId ?? null, quote, transactionId: order.transactionId });
  return "repaired";
}

/**
 * Find paid shop orders older than `olderThanMinutes` (so a checkout still in
 * flight isn't raced) with no original lab order, and create what's missing
 * through createShopLabOrder. `dryRun` only counts. Returns counts; a failure
 * on one order is logged (ids only, no PHI) and never stops the rest.
 */
export async function repairMissingShopLabOrders({
  olderThanMinutes = 10, dryRun = false, now = new Date(), since = env.LAB_SHOP_REPAIR_SINCE, database = db, log = console,
} = {}) {
  const conds = [eq(orders.status, "paid"), lt(orders.createdAt, new Date(now.getTime() - olderThanMinutes * 60_000))];
  if (since) conds.push(gte(orders.createdAt, new Date(since)));
  // The anti-join runs in SQL and the read is bounded: paid orders already carrying a lab order
  // (the vast majority) are never loaded. One extra row tells us the sweep was capped.
  conds.push(sql`not exists (select 1 from ${labOrders} where ${labOrders.source} = 'shop_order' and ${labOrders.isRemake} = false and ${labOrders.sourceId} = ${orders.id})`);
  const found = await database.select().from(orders).where(and(...conds)).orderBy(asc(orders.createdAt)).limit(SWEEP_LIMIT + 1);
  const missing = found.slice(0, SWEEP_LIMIT);

  const summary = { dryRun, checked: missing.length, missing: missing.length, repaired: 0, skippedPreLabOrders: 0, alreadyHadLabOrder: 0, failed: 0, capped: found.length > SWEEP_LIMIT };
  for (const order of missing) {
    try {
      const outcome = dryRun ? "dry" : await database.transaction((tx) => repairOne(tx, order));
      if (outcome === "repaired") summary.repaired += 1;
      else if (outcome === "preLabOrders") summary.skippedPreLabOrders += 1;
      else if (outcome === "alreadyHasLabOrder") summary.alreadyHadLabOrder += 1;
    } catch (err) {
      summary.failed += 1;
      log.error(`[LAB][SHOP_ORDER_REPAIR_FAILED] order=${order.id}: ${String(err?.message || err)}`);
    }
  }
  return summary;
}
