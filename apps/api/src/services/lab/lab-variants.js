import { inArray } from "drizzle-orm";
import { productVariants } from "../../db/schema/index.js";

/** Product code → catalog variant id for the codes that exist (db-free module: the import tools share it). */
export async function variantIdsForCodes(tx, codes) {
  const unique = [...new Set(codes.filter(Boolean).map(String))];
  if (unique.length === 0) return new Map();
  const rows = await tx
    .select({ id: productVariants.id, code: productVariants.code })
    .from(productVariants)
    .where(inArray(productVariants.code, unique));
  return new Map(rows.map((r) => [r.code, r.id]));
}
