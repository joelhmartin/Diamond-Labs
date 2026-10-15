import { ERROR_CODES } from "@my-app/shared";
import { extractDeclineMessage } from "../lib/payment-helpers.js";

/**
 * Replies shared by every charge-producing route module (checkout, invoice
 * payments, admin charge-on-behalf). Split out of payment.routes.js.
 */

// Per-route strict rate limit for the charge-producing endpoints (M3). Layered
// ON TOP of the global limiter; the global localhost allowList still applies in
// dev so local testing isn't throttled.
export const CHARGE_RATE_LIMIT = { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } };

/**
 * Map a charge error to a user-safe reply (H2). An error carrying an
 * Authorize.net response is a gateway-level decline → 402 CARD_DECLINED with the
 * gateway's own (user-safe) decline text. Anything else (network, parse, config)
 * is a system failure → 502 PAYMENT_GATEWAY_ERROR with a generic message. We
 * never leak internals or stack traces to the client.
 *
 * Fraud-review holds get their own answers: a hold we declined at the gateway
 * is a definitive "not charged" (402), but a hold we could NOT decline may still
 * be captured, so the client is told not to retry (409) — the lock helpers have
 * kept the idempotency key and invoice locks for the same reason.
 */
export function chargeErrorReply(reply, err) {
  if (err?.gatewayOutcomePending) {
    return reply.code(409).send({ error: ERROR_CODES.PAYMENT_UNDER_REVIEW });
  }
  if (err?.heldForReview) {
    return reply.code(402).send({ error: ERROR_CODES.PAYMENT_HELD_DECLINED });
  }
  if (err?.authNetResponse) {
    const message = extractDeclineMessage(err.authNetResponse) || ERROR_CODES.CARD_DECLINED.message;
    return reply.code(402).send({ error: { ...ERROR_CODES.CARD_DECLINED, message } });
  }
  return reply.code(502).send({ error: ERROR_CODES.PAYMENT_GATEWAY_ERROR });
}

/**
 * Reply for a per-invoice lock contention (D1). Reuses CHARGE_IN_PROGRESS's 409
 * shape with an invoice-specific message so the client shows a clean "retry".
 */
export function sendInvoiceLockedError(reply) {
  return reply.code(409).send({
    error: {
      ...ERROR_CODES.CHARGE_IN_PROGRESS,
      message: "A payment for this invoice is already in progress — please retry in a moment.",
    },
  });
}

/** Send the appropriate reply for a verifyAllocations result. */
export function sendAllocationError(reply, v) {
  if (v.kind === "validation") {
    return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: v.message } });
  }
  return reply.code(403).send({ error: { ...ERROR_CODES.FORBIDDEN, message: v.message } });
}
