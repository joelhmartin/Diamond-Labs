import { fieldSealer } from "../../lib/crypto.js";

/**
 * Lab-order field sealing, db-free so the import tools can seal a legacy
 * order's patient with the SAME sealer the live service uses (importing
 * lab-orders.service.js would load config/env.js and config/database.js).
 * Free text staff type can name a patient, so it is encrypted at rest like
 * rx_cases' free-text fields (B4 / phi-crypto.js).
 */
export const SECRET_ORDER_FIELDS = ["holdReason", "labNotes", "legacyPatient"];

const orderSecrets = fieldSealer(SECRET_ORDER_FIELDS);
export const sealOrder = orderSecrets.seal;
export const openOrder = orderSecrets.open;
