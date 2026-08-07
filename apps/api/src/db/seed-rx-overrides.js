/**
 * Seed high-confidence Seazona product-code overrides into `rx_code_overrides`.
 *
 *   node --env-file=.env apps/api/src/db/seed-rx-overrides.js          # apply
 *   DRY_RUN=1 node --env-file=.env apps/api/src/db/seed-rx-overrides.js # preview
 *
 * Only UNAMBIGUOUS exact catalog matches are seeded (verified against the live
 * Seazona catalog on 2026-06-24). Material/variant choices that need a lab
 * judgment call (e.g. ON-D/P/R material, MORA ClearSplint vs PMT, Shirazi's two
 * "Nylon" SKUs, sport-guard tier) are deliberately LEFT OUT — confirm those in
 * the Rx Mapping tester.
 *
 * These are overrides, so they remain fully editable in the tester afterward
 * (Search catalog… to reassign, Clear override to remove). Idempotent: re-runs
 * update the same `mapKey` rows rather than duplicating.
 *
 * mapKey format: primary:<deviceKey>:<material|"default">  |  mod:<label>
 */
import { db, queryClient } from "../config/database.js";
import { rxCodeOverrides } from "./schema/rx-code-overrides.js";
import { createId } from "../lib/id.js";

// Curated, high-confidence (device, material) → live Seazona SKU.
const MAPPINGS = [
  { mapKey: "primary:olmos-day:bioflex",        seazonaCode: "2527", seazonaName: "OD Bio Flex" },
  { mapKey: "primary:olmos-day:nylon",          seazonaCode: "2108", seazonaName: "OD Nylon" },
  { mapKey: "primary:olmos-day:acrylic-clasps", seazonaCode: "2103", seazonaName: "OD Acrylic W/Clasps" },
  { mapKey: "primary:olmos-day:dual-laminate",  seazonaCode: "2105", seazonaName: "OD Dual Laminate" },
  { mapKey: "primary:olmos-day:milled",         seazonaCode: "2106", seazonaName: "OD MILLED" },
  { mapKey: "primary:ara:default",              seazonaCode: "2592", seazonaName: "ARA- Nylon" },
  { mapKey: "primary:snorehook:default",        seazonaCode: "2154", seazonaName: "Snorehook" },
  // Guard mapKeys are slugified from the FULL matrix row label — the resolver
  // emits `guard:essix-tray:any`, not `guard:essix:any`. A shortened key here
  // would seed a row nothing ever looks up.
  { mapKey: "guard:essix-tray:any",             seazonaCode: "2161", seazonaName: "Essix Tray Non Printed (per arch)" },
];

const DRY_RUN = process.env.DRY_RUN === "1";

async function run() {
  console.log(`[seed-rx-overrides] ${MAPPINGS.length} high-confidence overrides${DRY_RUN ? " (DRY RUN)" : ""}`);
  for (const m of MAPPINGS) {
    console.log(`  ${m.mapKey}  →  ${m.seazonaCode} (${m.seazonaName})`);
    if (DRY_RUN) continue;
    await db
      .insert(rxCodeOverrides)
      .values({
        id: createId(),
        mapKey: m.mapKey,
        seazonaCode: m.seazonaCode,
        seazonaName: m.seazonaName,
        confirmedBy: "seed",
      })
      .onConflictDoUpdate({
        target: rxCodeOverrides.mapKey,
        set: {
          seazonaCode: m.seazonaCode,
          seazonaName: m.seazonaName,
          updatedAt: new Date(),
        },
      });
  }
  console.log(`[seed-rx-overrides] done${DRY_RUN ? " (no writes)" : ""}.`);
}

run()
  .catch((err) => {
    console.error("[seed-rx-overrides] FAILED:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await queryClient.end({ timeout: 5 }).catch(() => {});
  });
