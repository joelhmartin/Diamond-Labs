import { db } from "../config/database.js";
import { autopayEnrollments } from "../db/schema/index.js";
import { eq } from "drizzle-orm";
import { createId } from "../lib/id.js";
import { env } from "../config/env.js";
import { assertCardExists, CardNotFoundError } from "./card.service.js";

export class AutopayValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = "AutopayValidationError";
    this.field = field;
  }
}

/**
 * Raised when the card-on-file check could not be completed because the
 * gateway itself failed (network error, stale customerProfileId, transient
 * Authorize.net error) — as opposed to `CardNotFoundError`, which means the
 * gateway answered fine and the card genuinely isn't there. Route handlers
 * should map this to a 502/503, never to the "card not on file" 422 a real
 * CardNotFoundError produces — telling a doctor their card is missing when
 * the gateway just hiccupped is actively misleading.
 */
export class AutopayGatewayError extends Error {
  constructor(cause) {
    super(`Could not verify the card on file: ${cause?.message || cause}`);
    this.name = "AutopayGatewayError";
    this.cause = cause;
  }
}

/** The minimum this doctor may enroll at — the admin override wins if set. */
export function effectiveFloor(enrollment) {
  const override = enrollment?.minAmountOverride;
  return override != null ? Number(override) : Number(env.AUTOPAY_MIN_AMOUNT);
}

export async function getEnrollment(userId) {
  const [row] = await db
    .select()
    .from(autopayEnrollments)
    .where(eq(autopayEnrollments.userId, String(userId)))
    .limit(1);
  return row || null;
}

/**
 * Create or update an enrollment.
 *
 * `enabled` is NEVER implied — a new enrollment is created disabled and only an
 * explicit `enabled: true` turns it on. That keeps "a row exists" and "this
 * doctor is being charged" separate facts.
 */
export async function upsertEnrollment({
  user,
  amount,
  dayOfMonth,
  paymentProfileId,
  enabled,
  minAmountOverride,
  actorUserId,
}) {
  const day = Number(dayOfMonth);
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new AutopayValidationError("Day of month must be between 1 and 31.", "dayOfMonth");
  }

  const existing = await getEnrollment(user.id);
  const override = minAmountOverride !== undefined ? minAmountOverride : existing?.minAmountOverride ?? null;
  const floor = override != null ? Number(override) : Number(env.AUTOPAY_MIN_AMOUNT);

  const amt = Number(amount);
  if (!(amt > 0)) throw new AutopayValidationError("Amount must be greater than zero.", "amount");
  if (amt < floor) {
    throw new AutopayValidationError(
      `AutoPay amount must be at least $${floor.toFixed(2)}.`,
      "amount"
    );
  }

  // A card on file is a hard requirement — verified at the gateway, not just in
  // the UI. An enrollment pointing at a card that does not exist would fail
  // silently every cycle.
  //
  // The gateway check can fail two very different ways, and they must not be
  // conflated:
  //   1. CardNotFoundError — the gateway answered and the card genuinely isn't
  //      there. This is a real user error: reject with AutopayValidationError
  //      so the route can 422 and point the doctor at "add a card".
  //   2. Anything else (network error, stale customerProfileId, a non-"Ok"
  //      resultCode from Authorize.net) — the gateway itself is unwell.
  //      card.service.js's assertCardExists does not catch these; they
  //      propagate straight out of authorizenet.service.js's apiRequest. If we
  //      let a CardNotFoundError-style 422 result from this, a doctor with a
  //      perfectly good card on file would be told to go add one during a
  //      transient outage — which is worse than just failing the request.
  //      Wrap it distinctly (AutopayGatewayError) so the route layer can
  //      return a 502/503 instead.
  try {
    await assertCardExists(user, paymentProfileId);
  } catch (err) {
    if (err instanceof CardNotFoundError) {
      throw new AutopayValidationError(
        "That card is not on file. Add a card before enrolling in AutoPay.",
        "paymentProfileId"
      );
    }
    throw new AutopayGatewayError(err);
  }

  const values = {
    amount: amt.toFixed(2),
    dayOfMonth: day,
    paymentProfileId: String(paymentProfileId),
    minAmountOverride: override != null ? Number(override).toFixed(2) : null,
    updatedByUserId: actorUserId ? String(actorUserId) : null,
    updatedAt: new Date(),
  };
  if (enabled !== undefined) values.enabled = Boolean(enabled);

  if (existing) {
    await db.update(autopayEnrollments).set(values).where(eq(autopayEnrollments.userId, String(user.id)));
    return { ...existing, ...values };
  }

  const row = {
    id: createId(),
    userId: String(user.id),
    // Explicitly false unless the caller opted in.
    enabled: values.enabled ?? false,
    status: "active",
    consecutiveFailures: 0,
    createdByUserId: actorUserId ? String(actorUserId) : null,
    ...values,
  };
  await db.insert(autopayEnrollments).values(row);
  return row;
}

export async function deleteEnrollment(userId) {
  await db.delete(autopayEnrollments).where(eq(autopayEnrollments.userId, String(userId)));
}

export async function setPaused(userId, { paused, reason, actorUserId }) {
  const values = {
    status: paused ? "paused" : "active",
    pausedReason: paused ? String(reason || "manual") : null,
    updatedByUserId: actorUserId ? String(actorUserId) : null,
    updatedAt: new Date(),
  };
  // Resuming clears the failure counter so a recovered card gets a clean slate.
  if (!paused) values.consecutiveFailures = 0;
  await db.update(autopayEnrollments).set(values).where(eq(autopayEnrollments.userId, String(userId)));
  return getEnrollment(userId);
}
