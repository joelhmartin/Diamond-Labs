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
  // Reuse effectiveFloor rather than reimplementing the override/default logic
  // here — this is money arithmetic and must not have two places to diverge.
  const floor = effectiveFloor({ minAmountOverride: override });

  const amt = Number(amount);
  if (!(amt > 0)) throw new AutopayValidationError("Amount must be greater than zero.", "amount");

  // I5 — the floor check and the card-on-file gateway check exist to gate
  // turning AutoPay ON. Turning it OFF must never be blocked by them: both
  // admin surfaces implement "disable" as a full PUT carrying the existing
  // amount/day/card, so a raised AUTOPAY_MIN_AMOUNT or an Authorize.net
  // outage would otherwise 422/502 a disable request and leave the
  // enrollment stuck ENABLED — exactly when an admin most needs to stop it.
  // Skip ONLY on an EXPLICIT `enabled: false` — both real callers (the
  // doctor page, the admin drawer) always send `enabled` explicitly, so this
  // exactly targets a genuine disable action. Omitting the field (or passing
  // `true`) keeps validating, same as before this fix — a caller who doesn't
  // say "turn this off" gets no special treatment.
  const resultingEnabled = enabled !== false;

  if (resultingEnabled) {
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

  // Re-read rather than construct the return value. A locally-merged object
  // (`{ ...existing, ...values }` on update, or a hand-built row on insert)
  // drifts from what's actually persisted — DB-defaulted columns like
  // createdAt never make it into a value we never read back. Task 9 serializes
  // this straight into an HTTP response, so both branches must return the
  // identical, authoritative, freshly-persisted row.
  if (existing) {
    await db.update(autopayEnrollments).set(values).where(eq(autopayEnrollments.userId, String(user.id)));
    return getEnrollment(user.id);
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
  return getEnrollment(user.id);
}

/**
 * True when `paymentProfileId` is the card an ENABLED AutoPay enrollment for
 * this user charges. Deleting that card would make every later cycle fail (and
 * eventually pause the doctor), so both card-delete paths — the doctor's own
 * and the admin's — refuse it and ask for the AutoPay card to change first.
 */
export async function isCardUsedByAutopay(userId, paymentProfileId) {
  const enrollment = await getEnrollment(userId);
  return Boolean(enrollment?.enabled) && String(enrollment.paymentProfileId) === String(paymentProfileId);
}

/** Error body both card-delete routes return (409) for a card AutoPay uses. */
export const CARD_IN_USE_BY_AUTOPAY_MESSAGE =
  "This card is used by an active AutoPay enrollment. Change the AutoPay card or cancel AutoPay first.";

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
