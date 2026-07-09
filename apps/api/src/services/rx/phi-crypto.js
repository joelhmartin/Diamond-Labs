import {
  encryptField,
  decryptField,
  encryptJson,
  decryptJson,
} from "../../lib/crypto.js";

// Centralized PHI encryption for rx_cases rows (HIPAA §164.312(a)(2)(iv)).
//
// Apply encryptRxPhi() to the values object at EVERY write path and
// decryptRxPhi() to any row loaded from the DB at EVERY read path. Consumers
// that read PHI off a case row (build-order-payload, order-diff) must be handed
// a DECRYPTED row so they keep seeing plaintext.
//
// crypto.js is passthrough for values lacking the `enc:v1:` prefix, so
// un-migrated rows and synthetic plaintext test fixtures round-trip unchanged.

// Free-text PHI columns → encryptField / decryptField.
const TEXT_FIELDS = ["patientFirst", "patientLast", "dob", "contactPhone", "generalComments"];

// JSON-blob PHI columns (now stored as encrypted text) → encryptJson / decryptJson.
// payloadSnapshot is the Seazona order payload captured at approval — it embeds
// patientName, so it is treated as PHI just like the rest.
const JSON_FIELDS = ["shipTo", "formData", "deviceOptions", "payloadSnapshot"];

/**
 * Encrypt PHI fields on a values object bound for insert/update. Returns a NEW
 * object; only the PHI keys that are present are transformed. null/undefined
 * pass through unchanged (nullable columns stay null).
 * @param {object} row
 * @returns {object}
 */
export function encryptRxPhi(row) {
  if (!row || typeof row !== "object") return row;
  const out = { ...row };
  for (const f of TEXT_FIELDS) {
    if (f in out) out[f] = encryptField(out[f]);
  }
  for (const f of JSON_FIELDS) {
    if (f in out) out[f] = encryptJson(out[f]);
  }
  return out;
}

/**
 * Decrypt PHI fields on a row loaded from the DB. Returns a NEW object. Values
 * without the `enc:v1:` prefix (un-migrated / plaintext) pass through as-is.
 * @param {object} row
 * @returns {object}
 */
export function decryptRxPhi(row) {
  if (!row || typeof row !== "object") return row;
  const out = { ...row };
  for (const f of TEXT_FIELDS) {
    if (f in out) out[f] = decryptField(out[f]);
  }
  for (const f of JSON_FIELDS) {
    if (f in out) out[f] = decryptJson(out[f]);
  }
  return out;
}
