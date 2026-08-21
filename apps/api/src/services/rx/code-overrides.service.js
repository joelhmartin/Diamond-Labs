import { db } from "../../config/database.js";
import { rxCodeOverrides } from "../../db/schema/index.js";

/**
 * Load all DB overrides and index by mapKey.
 * Returns { [mapKey]: { code: seazonaCode, name: seazonaName, seazonaProductId } }
 *
 * Exported so other callers that need to resolve device selections against
 * confirmed overrides (e.g. seeding a case's order lines on submit) reuse
 * this loader instead of duplicating the query.
 */
export async function loadOverrides() {
  const rows = await db.select().from(rxCodeOverrides);
  const map = {};
  for (const row of rows) {
    map[row.mapKey] = {
      code: row.seazonaCode,
      name: row.seazonaName,
      seazonaProductId: row.seazonaProductId,
    };
  }
  return map;
}
