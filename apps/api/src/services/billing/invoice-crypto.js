import { fieldSealer } from "../../lib/crypto.js";

// Staff free text on billing rows can name a patient: encrypted at rest, like
// lab notes (B4). Decrypted rows are never logged.
const invoiceSecrets = fieldSealer(["notes", "voidReason"]);
const lineSecrets = fieldSealer(["priceNote"]);
const ledgerSecrets = fieldSealer(["note"]);

export const sealInvoice = invoiceSecrets.seal;
export const openInvoice = invoiceSecrets.open;
export const sealLine = lineSecrets.seal;
export const openLine = lineSecrets.open;
export const sealLedgerRow = ledgerSecrets.seal;
export const openLedgerRow = ledgerSecrets.open;
