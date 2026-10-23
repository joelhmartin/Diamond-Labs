import { fieldSealer } from "../../lib/crypto.js";

// Staff free text on billing rows can name a patient: encrypted at rest, like
// lab notes (B4). So can the Seazona text piece 5 imports (the invoice's
// patient, a line's description). Decrypted rows are never logged.
const invoiceSecrets = fieldSealer(["notes", "voidReason", "legacyPatient"]);
const lineSecrets = fieldSealer(["priceNote", "legacyDescription"]);
const ledgerSecrets = fieldSealer(["note"]);

export const sealInvoice = invoiceSecrets.seal;
export const openInvoice = invoiceSecrets.open;
export const sealLine = lineSecrets.seal;
export const openLine = lineSecrets.open;
export const sealLedgerRow = ledgerSecrets.seal;
export const openLedgerRow = ledgerSecrets.open;
