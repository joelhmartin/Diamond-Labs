// The lab's real mapKey vocabulary: every mapKey the catalog-map tables and resolvers
// can emit as a stable slug. rx_code_overrides rows keyed on anything else were created
// from a doctor-typed literal (mod:<text>, attr:<text>, primary:<device>:<text>) and are
// deleted by the scrub. Impure on purpose (imports app code); plan.js stays pure.
import { DEVICE_ROWS } from "../../services/rx/catalog-map/devices.table.js";
import { MODIFICATION_ROWS } from "../../services/rx/catalog-map/modifications.table.js";
import { ATTRIBUTE_ROWS } from "../../services/rx/catalog-map/attributes.table.js";
import { LAB_SERVICE_ROWS } from "../../services/rx/catalog-map/lab-services.js";
import { GUARD_ROWS } from "../../services/rx/catalog-map/resolvers/guard.js";
import { ORTHO_ROWS } from "../../services/rx/catalog-map/resolvers/ortho.js";

export function knownMapKeys() {
  const keys = new Set();
  for (const rows of [DEVICE_ROWS, MODIFICATION_ROWS, ATTRIBUTE_ROWS, LAB_SERVICE_ROWS, GUARD_ROWS, ORTHO_ROWS]) {
    for (const r of rows) if (r?.mapKey) keys.add(r.mapKey);
  }
  return [...keys];
}
