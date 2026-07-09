/**
 * Backfill: encrypt existing PHI at rest in rx_cases (HIPAA §164.312(a)(2)(iv)).
 *
 *   node --env-file=.env apps/api/src/db/encrypt-existing-phi.js
 *   PHI_ENCRYPTION_KEY=... node --env-file=.env apps/api/src/db/encrypt-existing-phi.js
 *
 * Run this ONCE, immediately AFTER migration 0014 (which converts the PHI
 * columns to text). It walks every rx_cases row and encrypts any of the PHI
 * fields — patientFirst, patientLast, dob, contactPhone, generalComments,
 * shipTo, formData, deviceOptions — that is not already `enc:v1:` ciphertext.
 *
 * Idempotent: values already encrypted (isEncrypted === true) are skipped, so
 * re-running is safe and a no-op once everything is migrated.
 *
 * Guard: refuses to run unless PHI_ENCRYPTION_KEY is set (the crypto helpers
 * would otherwise throw on the first encrypt anyway).
 *
 * NOTE on legacy JSON blobs: after migration 0014 the former jsonb columns
 * (ship_to, form_data, device_options) come back from Postgres as raw JSON
 * TEXT (e.g. '{"q1":"yes"}'). This script parses that text before re-encrypting
 * so the encrypted payload round-trips through decryptJson() as an object.
 */
import { eq } from "drizzle-orm";
import { db, queryClient } from "../config/database.js";
import { rxCases } from "./schema/index.js";
import {
  encryptField,
  encryptJson,
  isEncrypted,
} from "../lib/crypto.js";

const TEXT_FIELDS = ["patientFirst", "patientLast", "dob", "contactPhone", "generalComments"];
// payloadSnapshot (Seazona order payload, embeds patientName) is also PHI.
const JSON_FIELDS = ["shipTo", "formData", "deviceOptions", "payloadSnapshot"];

/**
 * Legacy jsonb→text columns come back as JSON strings. Parse them back to a
 * value so encryptJson stores an object that decryptJson can re-parse. If the
 * value is already an object (some drivers/paths), or parsing fails, fall back
 * to the raw value.
 */
function normalizeJsonForEncrypt(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== "string") return value; // already an object/array
  try {
    return JSON.parse(value);
  } catch {
    return value; // not valid JSON — encrypt the raw string as-is
  }
}

async function run() {
  if (!process.env.PHI_ENCRYPTION_KEY) {
    console.error(
      "Refusing to run: PHI_ENCRYPTION_KEY is not set. " +
        "Set it (64-char hex recommended) before backfilling PHI encryption."
    );
    process.exit(1);
  }

  const rows = await db.select().from(rxCases);
  console.log(`Scanning ${rows.length} rx_cases row(s)…`);

  let rowsUpdated = 0;
  let fieldsEncrypted = 0;
  let rowsSkipped = 0;

  for (const row of rows) {
    const patch = {};

    for (const f of TEXT_FIELDS) {
      const v = row[f];
      if (v === null || v === undefined) continue;
      if (isEncrypted(v)) continue;
      patch[f] = encryptField(v);
      fieldsEncrypted++;
    }

    for (const f of JSON_FIELDS) {
      const v = row[f];
      if (v === null || v === undefined) continue;
      if (isEncrypted(v)) continue;
      patch[f] = encryptJson(normalizeJsonForEncrypt(v));
      fieldsEncrypted++;
    }

    if (Object.keys(patch).length === 0) {
      rowsSkipped++;
      continue;
    }

    await db.update(rxCases).set(patch).where(eq(rxCases.id, row.id));
    rowsUpdated++;
  }

  console.log("─────────────────────────────────────────────");
  console.log(`Rows updated:      ${rowsUpdated}`);
  console.log(`Rows already OK:   ${rowsSkipped}`);
  console.log(`Fields encrypted:  ${fieldsEncrypted}`);
  console.log("Backfill complete.");

  await queryClient.end();
}

run().catch(async (err) => {
  console.error("encrypt-existing-phi failed:", err);
  try {
    await queryClient.end();
  } catch {}
  process.exit(1);
});
