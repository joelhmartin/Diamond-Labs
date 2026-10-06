/**
 * Build the owned catalog from the Seazona products mirror.
 *
 *   pnpm db:import-catalog            # write
 *   DRY_RUN=1 pnpm db:import-catalog  # preview only
 *
 * Idempotent: a planned family is skipped when any of its products is already
 * a variant (matched by legacySeazonaProductId).
 */
import { inArray } from "drizzle-orm";
import { db } from "../config/database.js";
import { products, productVariants } from "./schema/index.js";
import { FAMILY_SEED } from "./catalog-import/family-seed.js";
import { planCatalogImport } from "./catalog-import/plan-catalog.js";
import { insertPlannedFamily } from "../services/catalog.service.js";
import { SEED_CATALOG } from "../../../web/src/data/catalog.js";

const DRY_RUN = process.env.DRY_RUN === "1";

const rows = await db.select().from(products);
const { families, warnings } = planCatalogImport({ products: rows, familySeed: FAMILY_SEED, shopSeed: SEED_CATALOG });

const legacyIds = families.flatMap((f) => f.variants.map((v) => v.legacySeazonaProductId));
const existing = new Set(
  legacyIds.length
    ? (await db.select({ id: productVariants.legacySeazonaProductId }).from(productVariants)
        .where(inArray(productVariants.legacySeazonaProductId, legacyIds))).map((r) => r.id)
    : [],
);
const todo = families.filter((f) => !f.variants.some((v) => existing.has(v.legacySeazonaProductId)));

console.log(`${rows.length} products → ${families.length} families (${todo.length} new, ${families.length - todo.length} already imported)`);
console.log(`  grouped: ${todo.filter((f) => f.options.length > 0).map((f) => `${f.name} (${f.variants.length})`).join(", ") || "none"}`);
console.log(`  shop: ${todo.filter((f) => f.channel === "shop").length}, lab-billed: ${todo.filter((f) => f.channel === "rx").length}`);
for (const w of warnings) console.warn(`  ! ${w}`);

if (DRY_RUN) {
  console.log("DRY RUN — nothing written.");
  process.exit(0);
}

await db.transaction(async (tx) => {
  for (const f of todo) await insertPlannedFamily(tx, f);
});
console.log(`Imported ${todo.length} families.`);
process.exit(0);
