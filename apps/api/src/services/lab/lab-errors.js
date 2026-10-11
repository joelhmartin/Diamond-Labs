import { LabOrderError } from "./lab-order-rules.js";

const STATUS = {
  NOT_FOUND: 404,
  STALE: 409,
  ALREADY_RELEASED: 409,
  CONFLICT: 409,
  INVALID_TRANSITION: 422,
  REASON_REQUIRED: 422,
  INVALID: 422,
  RELEASE_BLOCKED: 422,
};

/** LabOrderError → HTTP reply ({ status, body }); anything else is not ours to swallow (null). */
export function labErrorReply(err) {
  if (!(err instanceof LabOrderError)) return null;
  const status = STATUS[err.code] ?? 422;
  const error = { code: err.code, status, message: err.message };
  if (err.allowed) error.allowed = err.allowed;
  if (err.blocking) error.blocking = err.blocking;
  return { status, body: { error } };
}
