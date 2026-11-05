import { and, eq, inArray } from "drizzle-orm";
import { db } from "../config/database.js";
import { clientPrices, productVariants, productFamilies } from "../db/schema/index.js";
import { createId } from "../lib/id.js";
import { loadClientPriceResolution, loadEffectiveClientPrices } from "./pricing.service.js";

export async function listForClient(clientUserId, listPrices = new Map()) {
  const rows = await db
    .select({ p: clientPrices, v: productVariants, f: productFamilies })
    .from(clientPrices)
    .innerJoin(productVariants, eq(productVariants.id, clientPrices.variantId))
    .innerJoin(productFamilies, eq(productFamilies.id, productVariants.familyId))
    .where(eq(clientPrices.clientUserId, clientUserId));
  return rows
    .map(({ p, v, f }) => ({
      ...p, variantName: v.name, variantCode: v.code, basePriceCents: v.basePriceCents, familyName: f.name,
      // What the client's assigned lists alone would charge, so the page can flag an override equal to it.
      listPriceCents: listPrices.get(p.variantId)?.cents ?? null,
    }))
    .sort((a, b) => a.familyName.localeCompare(b.familyName) || a.variantName.localeCompare(b.variantName));
}

/**
 * Every variant the client pays a non-base price for, as the one resolution
 * path decides it (override, else first assigned list): the pricing page's
 * "effective" view, with `source` and `listName`.
 */
export async function effectiveForClient(clientUserId, database = db) {
  return effectiveRows(await loadEffectiveClientPrices(clientUserId, null, database), database);
}

/** The pricing page's one read: overrides (with `listPriceCents`) and the effective view, from one resolution. */
export async function priceViewForClient(clientUserId, database = db) {
  const { effective, listOnly } = await loadClientPriceResolution(clientUserId, null, database);
  const [prices, effectiveList] = await Promise.all([listForClient(clientUserId, listOnly), effectiveRows(effective, database)]);
  return { prices, effective: effectiveList };
}

async function effectiveRows(effective, database) {
  if (effective.size === 0) return [];
  const variants = await database
    .select({
      variantId: productVariants.id, variantName: productVariants.name, variantCode: productVariants.code,
      basePriceCents: productVariants.basePriceCents, familyName: productFamilies.name,
    })
    .from(productVariants)
    .innerJoin(productFamilies, eq(productFamilies.id, productVariants.familyId))
    .where(inArray(productVariants.id, [...effective.keys()]));
  return variants
    .map((v) => ({ ...v, ...effective.get(v.variantId) }))
    .sort((a, b) => a.familyName.localeCompare(b.familyName) || a.variantName.localeCompare(b.variantName));
}

/** A price entered by staff is reviewed by definition. */
export async function upsertManual({ clientUserId, variantId, priceCents, note = null, adminId }) {
  const now = new Date();
  await db.insert(clientPrices).values({
    id: createId(), clientUserId, variantId, priceCents, source: "manual",
    note, reviewedAt: now, reviewedBy: adminId,
  }).onConflictDoUpdate({
    target: [clientPrices.clientUserId, clientPrices.variantId],
    set: { priceCents, source: "manual", note, reviewedAt: now, reviewedBy: adminId, updatedAt: now },
  });
}

export async function removePrice(clientUserId, variantId) {
  const deleted = await db.delete(clientPrices)
    .where(and(eq(clientPrices.clientUserId, clientUserId), eq(clientPrices.variantId, variantId)))
    .returning({ id: clientPrices.id });
  return deleted.length > 0;
}

export async function markReviewed({ clientUserId, variantIds, adminId }) {
  const updated = await db.update(clientPrices)
    .set({ reviewedAt: new Date(), reviewedBy: adminId, updatedAt: new Date() })
    .where(and(eq(clientPrices.clientUserId, clientUserId), inArray(clientPrices.variantId, variantIds)))
    .returning({ id: clientPrices.id });
  return updated.length;
}
