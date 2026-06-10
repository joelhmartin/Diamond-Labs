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
 *   - Shop-presentation (`imageUrl`, `description`, `purchasable`, `category`,
 *     `catalogId`): our local data — PRESERVED on update, never touched by sync.
 *
 * Idempotent. Safe to run on a schedule (cron / Cloud Scheduler) — re-running
 * with no upstream changes is a no-op aside from refreshing `lastSyncedAt`.
 *
 * NOTE: products removed upstream in Seazona are NOT deleted locally — stale rows
 * persist (intentional, to avoid clobbering shop-presentation data and orphaning
 * references); cleanup of removed products is left to a future manual/soft-delete pass.
 *
 * This module exports `syncSeazonaProducts({ dryRun })` so the admin route can
 * trigger a sync against the app's shared pooled `db`. The CLI entry (below)
 * manages its OWN db/queryClient lifecycle + exit codes.
 */
import { pathToFileURL } from "node:url";
import { products } from "./schema/index.js";
import * as seazonaService from "../services/seazona.service.js";

/**
 * Raised when Seazona returns an empty product list while the local mirror is
 * non-empty — almost always a credential/connectivity failure, not a genuinely
 * empty catalog. Callers should treat it as a fail (CLI: exit 1; route: 502).
 */
export class EmptyRemoteError extends Error {
  constructor(localCount) {
    super(
      `Seazona returned 0 products but the local table has ${localCount} rows. ` +
        "This almost certainly indicates an API credential or connectivity failure, not an " +
        "empty catalog. Aborting without modifying any data.",
    );
    this.name = "EmptyRemoteError";
    this.localCount = localCount;
  }
}

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

/**
 * Core sync. Fetches the full Seazona product list and upserts each row into the
 * `products` mirror using the supplied `db` handle. Returns a summary.
 *
 * @param {object} db - a Drizzle handle (shared pooled `db` for the route, the
 *   CLI's own handle for command-line use). The function never opens or closes a
 *   connection itself — lifecycle is the caller's responsibility.
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun=false] - when true, no writes occur; counts are
 *   still computed from a snapshot of existing ids.
 * @returns {Promise<{ inserted: number, updated: number, total: number,
 *   skippedNoId: number, errors: Array<{ seazonaProductId: string, message: string }> }>}
 * @throws {EmptyRemoteError} when remote is empty but the local mirror is not.
 */
export async function syncSeazonaProducts(db, { dryRun = false } = {}) {
  const remote = await seazonaService.listProducts();
  console.log(`Fetched ${remote.length} products from Seazona`);

  let inserted = 0;
  let updated = 0;
  let skippedNoId = 0;
  const errors = [];

  // Snapshot existing ids so we can report insert vs. update counts even in dryRun.
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
    throw new EmptyRemoteError(existingIds.size);
  }

  for (const p of remote) {
    const seazonaProductId = p.id != null ? String(p.id) : null;
    if (!seazonaProductId) {
      skippedNoId++;
      continue;
    }

    const exists = existingIds.has(seazonaProductId);

    try {
      if (!dryRun) {
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
            // (imageUrl, description, purchasable, category, catalogId) are
            // intentionally omitted so local edits survive the sync.
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

  return { inserted, updated, total: inserted + updated, skippedNoId, errors };
}

/**
 * CLI entry: owns its own queryClient lifecycle + exit codes. Lazily imports the
 * shared db/queryClient so importing this module from a request handler does NOT
 * pull in the CLI's connection.
 */
async function runCli() {
  const dryRun = process.env.DRY_RUN === "1";
  console.log(dryRun ? "DRY RUN — no writes will occur" : "Syncing Seazona products…");

  const { db, queryClient } = await import("../config/database.js");

  try {
    const { inserted, updated, total, skippedNoId, errors } =
      await syncSeazonaProducts(db, { dryRun });

    console.log("");
    console.log(dryRun ? "Would have:" : "Done.");
    console.log(`  Inserted: ${inserted}`);
    console.log(`  Updated:  ${updated}`);
    console.log(`  Total:    ${total}`);
    if (skippedNoId) console.log(`  Skipped (no id): ${skippedNoId}`);
    if (errors.length) {
      console.log(`  Errors:   ${errors.length}`);
      for (const e of errors.slice(0, 10)) {
        console.log(`    - ${e.seazonaProductId}: ${e.message}`);
      }
      if (errors.length > 10) console.log(`    … and ${errors.length - 10} more`);
    }

    await queryClient.end();
  } catch (err) {
    if (err instanceof EmptyRemoteError) {
      console.error(`ERROR: ${err.message}`);
    } else {
      console.error("Seazona product sync failed:", err);
    }
    try { await queryClient.end(); } catch {}
    process.exit(1);
  }
}

// Only run the CLI when invoked directly (`node src/db/sync-seazona-products.js`),
// not when imported by a route. pathToFileURL handles paths with spaces (this
// repo lives under "G-DRIVE SSD"), which a naive `file://` concat would not.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
