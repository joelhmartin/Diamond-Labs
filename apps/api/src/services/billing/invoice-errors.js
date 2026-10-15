import { InvoiceError } from "./invoice-rules.js";

const STATUS = { NOT_FOUND: 404, STALE: 409, LOCKED: 409, INVALID: 422, INVALID_TRANSITION: 422, REASON_REQUIRED: 422, OVERPAY: 422 };

/** InvoiceError → HTTP reply ({ status, body }); anything else is not ours to swallow (null). */
export function invoiceErrorReply(err) {
  if (!(err instanceof InvoiceError)) return null;
  const status = STATUS[err.code] ?? 422;
  return { status, body: { error: { code: err.code, status, message: err.message } } };
}
