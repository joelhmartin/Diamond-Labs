/**
 * The invoice/money paths' app error (invoice-errors.js maps its code to an
 * HTTP status). Its own module so the pure scope rules (client-scope-rules.js)
 * can build one without importing invoice-rules.js, which imports them.
 */
export class InvoiceError extends Error {
  /**
   * @param {"NOT_FOUND"|"PRACTICE_REQUIRED"|"STALE"|"LOCKED"|"INVALID"|"INVALID_TRANSITION"|"REASON_REQUIRED"|"OVERPAY"} code
   * @param {string} message  safe to show staff
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "InvoiceError";
    this.code = code;
    Object.assign(this, extra);
  }
}
