/**
 * Apply the confirmed high-confidence catalog→Seazona mappings (bootstrap).
 *
 *   DRY_RUN=1 node --env-file=<prod-env> src/db/apply-catalog-mapping.js   # preview
 *   node --env-file=<prod-env> src/db/apply-catalog-mapping.js             # apply
 *
 * Reads DATABASE_URL from the environment (point it at PROD via cloud-sql-proxy).
 * For each mapping it sets the local shop-presentation fields on the Seazona
 * product mirror row:  catalog_id = <shop SKU>, purchasable = true.
 *
 * Only the 17 conflict-free high-confidence matches are applied. Duplicates and
 * ambiguous picks (catalog 91, 25-2, 26, 103, 93, 61) are intentionally left for
 * manual mapping via the admin dropdown — the schema's unique index on catalog_id
 * permits only one shop SKU per Seazona product.
 *
 * Idempotent: re-running sets the same values. Runs in a transaction; any unique
 * conflict or missing row aborts the whole batch with no partial writes.
 */
import postgres from "postgres";

// catalogId (shop SKU from apps/web/src/data/catalog.js) → Seazona product id.
const MAPPINGS = [
  { catalogId: "16",  seazonaProductId: "f40bb3f4-8407-40b8-bf5f-4d9e93409da2", note: "NovaDent IP 1 Box → Novadent IP (8 Pkts/56 Days)" },
  { catalogId: "18",  seazonaProductId: "5909f744-1929-434e-975c-cdcbb2ccbfad", note: "Diamond Rechargeable Sonic Cleaner → Diamond Sonic Cleaner" },
  { catalogId: "25",  seazonaProductId: "4efc8d78-6078-40eb-bd11-4225f816fb52", note: "Nylon Adjusting Burs (5 pcs.) → Nylon Adjusting Burs (Pk)" },
  { catalogId: "32",  seazonaProductId: "7ebe3869-4a0d-43ff-b60e-36b8d0a6fdaa", note: "Heating Torch → Heating Torch" },
  { catalogId: "62",  seazonaProductId: "27fe0059-a784-4d4c-a303-32195791de50", note: "Mute — Trial Pack → Mute Trial Pack" },
  { catalogId: "63",  seazonaProductId: "d479d96b-9bac-496a-8914-ad648febf33f", note: "DDSO Sample Models → DDSO Nylon Sample" },
  { catalogId: "70",  seazonaProductId: "445c26a5-b92b-47ed-bec1-88ab76ec2264", note: "Shirazi Hybrid (Printed Nylon) → Shirazi Hybrid Nylon Sample" },
  { catalogId: "72",  seazonaProductId: "a719ed5e-4de8-423c-b4b1-cb9c03a2bbed", note: "Diamond D Scan → Diamond D Scan Bite Registration" },
  { catalogId: "73",  seazonaProductId: "0a5aafc6-5a0d-4f29-8970-533d4d1cb031", note: "Diamond Bite Sticks → Diamond Bite Sticks (10 Pk.)" },
  { catalogId: "74",  seazonaProductId: "1f9729f8-682e-49b6-896c-111ffda7596a", note: "Diamond Impression Material → Diamond Impression" },
  { catalogId: "76",  seazonaProductId: "f0bf159f-dad0-4f73-a25d-82ffe921ff34", note: "Replacement Vertical Shims (Posterior) → Replacement Posterior Vertical Shims (Pr)" },
  { catalogId: "87",  seazonaProductId: "f94a8890-7b98-434a-8b8e-39b09b84e7d6", note: "True Functional Airway Nasal Spray → True Functional Airway Nasal Spray" },
  { catalogId: "92",  seazonaProductId: "2f4c5793-d5a6-4a60-a54e-306f0899ab24", note: "Single Nylon Adjusting Bur → Nylon Adjusting Bur (Single)" },
  { catalogId: "94",  seazonaProductId: "52cc796c-90be-4fd6-a846-e2880049ecc8", note: "Polishing Wheels → Polishing Wheels (4 PK)" },
  { catalogId: "102", seazonaProductId: "4b200df6-179c-4127-9451-9e5f8c9904d3", note: "Replacement Modular Tongue Positioners → Replacement Nylon Tongue Positioners" },
  { catalogId: "104", seazonaProductId: "fe9f86da-f6b3-4963-9297-4dcbbc36f8b2", note: "New Client Welcome Kit → New Client Welcome Kit" },
  { catalogId: "105", seazonaProductId: "5e76c7c8-188c-4a33-8827-f9bd4de91e9d", note: "Diamond A Classic → Diamond A Classic Bite Registration" },
];

const dryRun = process.env.DRY_RUN === "1";
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

async function run() {
  console.log(dryRun ? "DRY RUN — no writes will occur\n" : "Applying mappings to PRODUCTION\n");
  console.log(`Target DB host: ${url.replace(/:[^:@/]+@/, ":***@").replace(/^postgres(ql)?:\/\/[^/]*/, "(masked)")}\n`);

  let applied = 0;
  const missing = [];

  await sql.begin(async (tx) => {
    for (const m of MAPPINGS) {
      // Confirm the target row exists and show its current state.
      const [row] = await tx`
        SELECT seazona_product_id, name, code, price, catalog_id, purchasable
        FROM products WHERE seazona_product_id = ${m.seazonaProductId}
      `;
      if (!row) {
        missing.push(m);
        console.log(`  ✗ MISSING  [${m.catalogId}] ${m.note}  (no product row ${m.seazonaProductId})`);
        continue;
      }

      console.log(
        `  ${dryRun ? "·" : "✓"} [${m.catalogId}] ${row.name} ($${row.price})  ` +
          `catalog_id ${row.catalog_id ?? "—"}→${m.catalogId}, purchasable ${row.purchasable}→true`,
      );

      if (!dryRun) {
        await tx`
          UPDATE products
          SET catalog_id = ${m.catalogId}, purchasable = true, updated_at = now()
          WHERE seazona_product_id = ${m.seazonaProductId}
        `;
      }
      applied++;
    }

    if (missing.length) {
      throw new Error(
        `${missing.length} target product row(s) not found in this DB — aborting without writes. ` +
          `Is the product mirror synced here? Missing: ${missing.map((m) => m.catalogId).join(", ")}`,
      );
    }

    if (dryRun) {
      // Force rollback so a dry run never persists, even if logic above changed.
      throw new DryRunRollback();
    }
  }).catch((err) => {
    if (err instanceof DryRunRollback) return; // expected
    throw err;
  });

  console.log(`\n${dryRun ? "Would apply" : "Applied"}: ${applied}/${MAPPINGS.length}`);
  await sql.end();
}

class DryRunRollback extends Error {}

run().catch(async (err) => {
  console.error("\nFAILED:", err.message);
  try { await sql.end(); } catch {}
  process.exit(1);
});
