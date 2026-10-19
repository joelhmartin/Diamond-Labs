import { CARRIER_LABELS } from "@my-app/shared";

/** A shipping rule said no. `message` is safe to show staff. */
export class ShippingError extends Error {
  /**
   * @param {"NOT_FOUND"|"INVALID"|"NOT_SHIPPABLE"|"CARRIER_DISABLED"|"PURCHASE_UNCERTAIN"|"IN_PROGRESS"|"VOID_REFUSED"|"LABEL_NOT_SAVED"} code
   * @param {string} message
   * @param {object} [extra]  e.g. { problems: string[] }, { gatewayOutcomePending: true }, { cause }
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "ShippingError";
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * A carrier said no, or didn't answer. `message` is the carrier's own text
 * (shown to staff verbatim) or ours; it never contains a credential, and
 * request/response bodies are never attached. `uncertain` = a purchase whose
 * label may exist anyway (carrier-http.js decides).
 */
export class CarrierError extends Error {
  constructor(carrier, code, message, { httpStatus = null, timedOut = false, uncertain = false } = {}) {
    super(message);
    this.name = "CarrierError";
    this.carrier = carrier;
    this.code = code;
    this.httpStatus = httpStatus;
    this.timedOut = timedOut;
    this.uncertain = uncertain;
  }
}

/** The normalised { carrier, code, message } staff see. */
export const carrierProblem = (err) => ({ carrier: err.carrier, code: err.code, message: err.message });

const STATUS = {
  NOT_FOUND: 404, INVALID: 422, NOT_SHIPPABLE: 422, CARRIER_DISABLED: 422, VOID_REFUSED: 422,
  IN_PROGRESS: 409, PURCHASE_UNCERTAIN: 504, LABEL_NOT_SAVED: 500,
};

/** ShippingError / CarrierError → HTTP reply ({ status, body }); anything else is not ours (null). */
export function shippingErrorReply(err) {
  if (err instanceof CarrierError) {
    const label = CARRIER_LABELS[err.carrier] ?? err.carrier;
    return { status: 502, body: { error: { code: "CARRIER_ERROR", status: 502, message: `${label}: ${err.message}`, carrier: carrierProblem(err) } } };
  }
  if (!(err instanceof ShippingError)) return null;
  const status = STATUS[err.code] ?? 422;
  const error = { code: err.code, status, message: err.message };
  if (err.problems) error.problems = err.problems;
  return { status, body: { error } };
}
