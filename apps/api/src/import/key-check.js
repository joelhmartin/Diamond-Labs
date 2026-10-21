import { eq, sql } from "drizzle-orm";
import { encryptField, decryptField, isEncrypted } from "../lib/crypto.js";
import { ImportRefusal } from "./import-errors.js";

/**
 * Every piece-5 CLI must seal with PRODUCTION's PHI_ENCRYPTION_KEY: a raw store
 * or a load sealed with a developer's key (`node --env-file=.env` picks one up
 * when the shell sets none) would be unreadable in production. The import DB
 * keeps one sealed constant (the FIRST run records whatever PHI_ENCRYPTION_KEY is
 * present, so make it with production's key exported; the runbook repeats this); a target is checked against a sealed rx_cases value.
 */
export const KEY_CHECK_PLAINTEXT = "diamond-labs-import-key-check-v1";

/** True when `sealed` is ciphertext the current key opens (and equals `plaintext` when given). Never throws. */
export function keyMatches(sealed, plaintext = null) {
  if (!isEncrypted(sealed)) return false;
  try {
    const opened = decryptField(sealed);
    return plaintext == null ? true : opened === plaintext;
  } catch {
    return false;
  }
}

/** Written on first use, verified on every later run. `keyCheck` is the import DB's key_check table. */
export async function assertImportKey(importDb, { keyCheck }) {
  const [row] = await importDb.select().from(keyCheck).where(eq(keyCheck.id, "phi"));
  if (!row) {
    await importDb.insert(keyCheck).values({ id: "phi", value: encryptField(KEY_CHECK_PLAINTEXT) });
    return "created";
  }
  if (!keyMatches(row.value, KEY_CHECK_PLAINTEXT)) {
    throw new ImportRefusal("PHI_ENCRYPTION_KEY does not open the import DB's key check. Export production's key into the shell for this command (docs/import-operations.md); never use the one in .env.");
  }
  return "verified";
}

/** The target must hold a sealed patient name the current key opens. Read-only. */
export async function assertTargetKey(targetDb) {
  const result = await targetDb.execute(sql`select patient_first as v from rx_cases where patient_first like 'enc:v1:%' limit 1`);
  const sample = (result?.rows ?? result)?.[0]?.v;
  if (!sample) throw new ImportRefusal("The target has no sealed rx_cases row to check PHI_ENCRYPTION_KEY against. Refusing to write.");
  if (!keyMatches(sample)) throw new ImportRefusal("PHI_ENCRYPTION_KEY does not open the target's sealed data. Refusing to write.");
}
