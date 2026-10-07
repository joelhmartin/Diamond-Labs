import { and, eq, inArray } from "drizzle-orm";
import { db } from "../config/database.js";
import { clientPrices, productVariants, productFamilies } from "../db/schema/index.js";
import { createId } from "../lib/id.js";

export async function listForClient(clientUserId) {
  const rows = await db
    .select({ p: clientPrices, v: productVariants, f: productFamilies })
    .from(clientPrices)
    .innerJoin(productVariants, eq(productVariants.id, clientPrices.variantId))
    .innerJoin(productFamilies, eq(productFamilies.id, productVariants.familyId))
    .where(eq(clientPrices.clientUserId, clientUserId));
  return rows
    .map(({ p, v, f }) => ({
      ...p, variantName: v.name, variantCode: v.code, basePriceCents: v.basePriceCents, familyName: f.name,
    }))
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
