import { and, eq, inArray } from "drizzle-orm";
import { db } from "../config/database.js";
import { productVariants, productFamilies, clientPrices } from "../db/schema/index.js";
import { priceLines } from "../lib/pricing.js";
import { PRICING } from "../config/pricing.js";

/** Whose negotiated prices apply to a request — null means guest pricing. */
export function pricingClientFor(user) {
  if (!user || user.role !== "doctor" || user.approvalStatus !== "approved") return null;
  return user.id;
}

/** Variants by id, with `active` folding in the family's active flag and shop channel. */
export async function loadShopVariants(variantIds) {
  if (variantIds.length === 0) return new Map();
  const rows = await db
    .select({ v: productVariants, f: productFamilies })
    .from(productVariants)
    .innerJoin(productFamilies, eq(productFamilies.id, productVariants.familyId))
    .where(inArray(productVariants.id, variantIds));
  return new Map(rows.map(({ v, f }) => [v.id, { ...v, active: v.active && f.active && f.channel !== "rx" }]));
}

export async function loadClientPrices(clientUserId, variantIds) {
  if (!clientUserId || variantIds.length === 0) return new Map();
  const rows = await db
    .select({ variantId: clientPrices.variantId, priceCents: clientPrices.priceCents })
    .from(clientPrices)
    .where(and(eq(clientPrices.clientUserId, clientUserId), inArray(clientPrices.variantId, variantIds)));
  return new Map(rows.map((r) => [r.variantId, r.priceCents]));
}

export async function priceShopCart({ lines, clientUserId = null }) {
  const ids = [...new Set(lines.map((l) => l.variantId))];
  const [variants, prices] = await Promise.all([loadShopVariants(ids), loadClientPrices(clientUserId, ids)]);
  return priceLines({ lines, variants, clientPrices: prices, config: PRICING });
}
