import { env } from "../config/env.js";

/**
 * Maintenance switch for the cutover freeze (PAYMENTS_PAUSED=true): refuses
 * every request that would START a card payment or write the invoice ledger by
 * hand. It must never guard /payments/hosted-complete: that call records a
 * charge Authorize.net has already captured, and refusing it would lose the
 * record. Keep this file identical on main and feat/own-the-lab.
 */
export const PAYMENTS_PAUSED_MESSAGE = "Payments are paused for an upgrade. Please try again later.";

export function paymentsPausedGuard(isPaused = () => env.PAYMENTS_PAUSED === true) {
  return async function paymentsPaused(request, reply) {
    if (!isPaused()) return;
    return reply.code(503).send({ error: { code: "PAYMENTS_PAUSED", message: PAYMENTS_PAUSED_MESSAGE } });
  };
}

export const paymentsPaused = paymentsPausedGuard();
