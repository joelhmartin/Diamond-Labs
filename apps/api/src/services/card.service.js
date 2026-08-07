import { db } from "../config/database.js";
import { users } from "../db/schema/index.js";
import { eq } from "drizzle-orm";
import * as authorizenetService from "./authorizenet.service.js";

export class CardNotFoundError extends Error {
  constructor(paymentProfileId) {
    super(`Payment profile ${paymentProfileId} was not found on this account.`);
    this.name = "CardNotFoundError";
  }
}

/**
 * Lazily create an Authorize.net CIM customer profile for `user` if they don't
 * have one yet. Persists the new ID to the DB row and reflects it on the
 * in-flight user object so subsequent reads within the same request don't need
 * an extra DB round-trip. Returns the customerProfileId (existing or new).
 *
 * Takes a plain user object rather than reading request.user, so admin routes
 * acting on behalf of a doctor can reuse it by SELECTing the target user first.
 */
export async function ensureCustomerProfile(user) {
  let customerProfileId = user.authorizeNetCustomerProfileId;
  if (!customerProfileId) {
    customerProfileId = await authorizenetService.createCustomerProfile({
      email: user.email,
      description: `Doctor: ${user.name}`,
    });
    await db
      .update(users)
      .set({ authorizeNetCustomerProfileId: customerProfileId, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    user.authorizeNetCustomerProfileId = customerProfileId;
  }
  return customerProfileId;
}

/** Cards on file, newest gateway state, with the user's default flagged. */
export async function listCardsForUser(user) {
  if (!user.authorizeNetCustomerProfileId) return [];
  const profiles = await authorizenetService.listPaymentProfiles(user.authorizeNetCustomerProfileId);
  return (profiles || []).map((p) => ({
    ...p,
    isDefault: String(p.paymentProfileId) === String(user.defaultPaymentProfileId || ""),
  }));
}

/**
 * Assert a payment profile really belongs to this user, at the gateway.
 * AutoPay enrollment depends on this — an enrollment pointing at a card that
 * does not exist would fail silently every cycle.
 */
export async function assertCardExists(user, paymentProfileId) {
  const cards = await listCardsForUser(user);
  if (!cards.some((c) => String(c.paymentProfileId) === String(paymentProfileId))) {
    throw new CardNotFoundError(paymentProfileId);
  }
}
