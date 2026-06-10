/**
 * One-way Seazona→local product sync.
 *
 *   pnpm db:sync-products
 *   DRY_RUN=1 pnpm db:sync-products        # preview only, no writes
 *
 * Seazona is the system of record for products — there is no product-create API
 * there, so this job is strictly read-only against Seazona. It pulls the full
 * product list and upserts each one into our local `products` mirror table.
 *
 * Field ownership:
 *   - Seazona-authoritative (`code`, `name`, `taxable`, `price`): overwritten on
 *     every sync.
 *   - Shop-presentation (`imageUrl`, `description`, `purchasable`, `category`):
 *     our local data — PRESERVED on update, never touched by the sync.
 *
 * Idempotent. Safe to run on a schedule (cron / Cloud Scheduler) — re-running
 * with no upstream changes is a no-op aside from refreshing `lastSyncedAt`.
 *
 * NOTE: products removed upstream in Seazona are NOT deleted locally — stale rows
 * persist (intentional, to avoid clobbering shop-presentation data and orphaning
 * references); cleanup of removed products is left to a future manual/soft-delete pass.
 */
import { db, queryClient } from "../config/database.js";
import { products } from "./schema/index.js";
import * as seazonaService from "../services/seazona.service.js";

const DRY_RUN = process.env.DRY_RUN === "1";

/** Normalize a Seazona price into a numeric string (or null). */
function normalizePrice(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    console.warn(`normalizePrice: non-numeric price ${JSON.stringify(raw)} — storing null`);
    return null;
  }
  return n.toFixed(2);
}

async function run() {
  console.log(DRY_RUN ? "DRY RUN — no writes will occur" : "Syncing Seazona products…");

  const remote = await seazonaService.listProducts();
  console.log(`Fetched ${remote.length} products from Seazona`);

  let inserted = 0;
  let updated = 0;
  let skippedNoId = 0;
  const errors = [];

  // Snapshot existing ids so we can report insert vs. update counts even in DRY_RUN.
  const existingRows = await db
    .select({ seazonaProductId: products.seazonaProductId })
    .from(products);
  const existingIds = new Set(existingRows.map((r) => r.seazonaProductId));

  // Guard against silent failure: seazonaService.listProducts() returns [] both
  // for a genuinely empty catalog AND for any API failure (bad creds, non-2xx,
  // network). If the remote is empty but we already have local rows, treat it as
  // a likely connectivity/credential failure rather than a real empty catalog —
  // otherwise a scheduled job would report healthy while syncing nothing. A
  // genuine first run (empty local table) is allowed to proceed with 0 products.
  if (remote.length === 0 && existingIds.size > 0) {
    console.error(
      `ERROR: Seazona returned 0 products but the local table has ${existingIds.size} rows. ` +
        "This almost certainly indicates an API credential or connectivity failure, not an " +
        "empty catalog. Aborting without modifying any data.",
    );
    await queryClient.end();
    process.exit(1);
  }

  for (const p of remote) {
    const seazonaProductId = p.id != null ? String(p.id) : null;
    if (!seazonaProductId) {
      skippedNoId++;
      continue;
    }

    const exists = existingIds.has(seazonaProductId);

    try {
      if (!DRY_RUN) {
        await db
          .insert(products)
          .values({
            seazonaProductId,
            code: p.code ?? null,
            name: p.name ?? null,
            taxable: Boolean(p.taxable),
            price: normalizePrice(p.price),
            lastSyncedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: products.seazonaProductId,
            // ONLY Seazona-authoritative fields. Shop-presentation fields
            // (imageUrl, description, purchasable, category) are intentionally
            // omitted so local edits survive the sync.
            set: {
              code: p.code ?? null,
              name: p.name ?? null,
              taxable: Boolean(p.taxable),
              price: normalizePrice(p.price),
              lastSyncedAt: new Date(),
              updatedAt: new Date(),
            },
          });
      }

      if (exists) updated++;
      else {
        inserted++;
        existingIds.add(seazonaProductId);
      }
    } catch (err) {
      errors.push({ seazonaProductId, message: err.message });
    }
  }

  console.log("");
  console.log(DRY_RUN ? "Would have:" : "Done.");
  console.log(`  Inserted: ${inserted}`);
  console.log(`  Updated:  ${updated}`);
  console.log(`  Total:    ${inserted + updated}`);
  if (skippedNoId) console.log(`  Skipped (no id): ${skippedNoId}`);
  if (errors.length) {
    console.log(`  Errors:   ${errors.length}`);
    for (const e of errors.slice(0, 10)) {
      console.log(`    - ${e.seazonaProductId}: ${e.message}`);
    }
    if (errors.length > 10) console.log(`    … and ${errors.length - 10} more`);
  }

  await queryClient.end();
}

run().catch(async (err) => {
  console.error("Seazona product sync failed:", err);
  try { await queryClient.end(); } catch {}
  process.exit(1);
});
