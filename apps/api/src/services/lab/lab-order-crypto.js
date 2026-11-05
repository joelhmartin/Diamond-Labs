import { fieldSealer, encryptField, decryptField } from "../../lib/crypto.js";
import { createId } from "../../lib/id.js";

/**
 * Lab-order field sealing, db-free so the import tools can seal a legacy
 * order's patient with the SAME sealer the live service uses (importing
 * lab-orders.service.js would load config/env.js and config/database.js).
 * Free text staff type can name a patient, so it is encrypted at rest like
 * rx_cases' free-text fields (B4 / phi-crypto.js).
 */
export const SECRET_ORDER_FIELDS = ["holdReason", "labNotes", "legacyPatient", "enclosures", "patientName"];

const orderSecrets = fieldSealer(SECRET_ORDER_FIELDS);
export const sealOrder = orderSecrets.seal;
export const openOrder = orderSecrets.open;

/** A timeline event as stored: fresh id, note encrypted (it can carry free text). */
export function sealEvent(e) {
  return { ...e, id: createId(), note: e.note == null ? null : encryptField(e.note) };
}
export function openEvent(e) {
  return { ...e, note: e.note == null ? null : decryptField(e.note) };
}
