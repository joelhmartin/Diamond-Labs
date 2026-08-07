/**
 * One-time remap of rx_code_overrides.map_key from the old label-derived keys
 * to the stable slugs introduced with catalog-map.
 *
 *   node --env-file=.env apps/api/src/db/migrate-rx-override-keys.js
 *   DRY_RUN=1 … to preview
 */
import { eq } from "drizzle-orm";
import { db, queryClient } from "../config/database.js";
import { rxCodeOverrides } from "./schema/rx-code-overrides.js";

const REMAP = {
  "primary:olmos-day:OD BIOFLEX":       "primary:olmos-day:bioflex",
  "primary:olmos-day:Printed Nylon":    "primary:olmos-day:nylon",
  "primary:olmos-day:Acrylic w/clasps": "primary:olmos-day:acrylic-clasps",
  "primary:olmos-day:Dual-Laminate":    "primary:olmos-day:dual-laminate",
  "primary:olmos-day:Milled":           "primary:olmos-day:milled",
  "primary:olmos-day:OD (PMT)":         "primary:olmos-day:pmt",
  "primary:ddso:Nylon":                 "primary:ddso:nylon",
  "primary:ddso:Biomed":                "primary:ddso:biomed",
  "primary:ara:default":                "primary:ara:default",
  "primary:mora:default":               "primary:mora:pmt",
  "primary:snorehook:SnoreHook":        "primary:snorehook:default",
  "primary:shirazi-hybrid:default":     "primary:shirazi-hybrid:nylon",
  "primary:cadcam-d-pro:default":       "primary:cadcam-d-pro:nylon",
  "primary:guard:Essix retainer (tray)": "guard:essix:any",
  "primary:guard:Whitening tray":        "guard:bleaching:any",
  "mod:Labial bow":                      "mod:labial-bow",
};

const DRY_RUN = process.env.DRY_RUN === "1";

async function run() {
  const rows = await db.select().from(rxCodeOverrides);
  let moved = 0;
  for (const row of rows) {
    const next = REMAP[row.mapKey];
    if (!next || next === row.mapKey) continue;
    console.log(`  ${row.mapKey}  →  ${next}  (${row.seazonaCode})`);
    moved++;
    if (DRY_RUN) continue;
    await db.update(rxCodeOverrides).set({ mapKey: next, updatedAt: new Date() }).where(eq(rxCodeOverrides.id, row.id));
  }
  console.log(`[migrate-rx-override-keys] ${rows.length} rows, ${moved} remapped${DRY_RUN ? " (no writes)" : ""}.`);
}

run()
  .catch((err) => { console.error("[migrate-rx-override-keys] FAILED:", err); process.exitCode = 1; })
  .finally(async () => { await queryClient.end({ timeout: 5 }).catch(() => {}); });
