import { db } from "../config/database.js";
import { redis } from "../config/redis.js";
import { autopayEnrollments, autopayAttempts, users } from "../db/schema/index.js";
import { eq, and, or } from "drizzle-orm";
import { createId } from "../lib/id.js";
import { env } from "../config/env.js";
import { toCents, toDecimalString } from "../lib/money.js";
import { openInvoicesForClient } from "./billing/ledger.service.js";
import { chargeSavedCardAndRecord } from "./card-charge.service.js";
import { allocateOldestFirst, resolveChargeCents } from "@my-app/shared";
import { isDueOn, isRetryDay, cycleKeyFor, labDateFor } from "../lib/autopay-schedule.js";
import {
  withInvoiceLocks,
  withIdempotency,
  isGatewayOutcomePending,
  ChargeInProgressError,
  InvoiceLockedError,
} from "../lib/payment-helpers.js";
import * as emailService from "./email.service.js";

/**
 * The AutoPay sweep. Balances come from OUR invoices and ledger
 * (own-the-lab piece 3), so every payment, including the checks staff
 * record, is visible before a card is charged. That retires the old
 * "cap at the legacy system's balance" go-live precondition. AUTOPAY_LIVE_RUN
 * still gates real charges: turning it on is a cutover decision.
 *
 * Money is integer cents; the enrollment amount and the attempt amounts are
 * numeric(12,2) dollar columns, converted at the read (toCents) and the
 * write (toDecimalString).
 */

/**
 * Thrown (inside the per-invoice lock, before the gateway call) when a
 * SUCCESSFUL real charge already exists for this user and cycle. The redis
 * idempotency key is a 24h cache scoped to the enrollment id, which doesn't
 * survive a charge-day change or a re-enroll; this fresh DB read keyed on the
 * doctor is the durable layer. Recorded as `skipped`, never as a decline.
 */
class AlreadyChargedThisCycleError extends Error {
  constructor() {
    super("A successful AutoPay charge already exists for this user this cycle.");
    this.name = "AlreadyChargedThisCycleError";
  }
}

/**
 * Thrown (inside the lock, before the gateway call) when the in-lock
 * re-verification fails: another payment may have landed on these invoices
 * since the sweep read them. Recorded as `failed`, never counted against
 * consecutiveFailures (no card was touched).
 */
class AllocationCapExceededError extends Error {
  constructor(message, kind) {
    super(message);
    this.kind = kind;
  }
}

/** Every attempt row for this user in this cycle (filtered in JS by the two call sites). */
async function attemptsThisCycle(userId, cycleKey) {
  return db
    .select({ status: autopayAttempts.status, dryRun: autopayAttempts.dryRun })
    .from(autopayAttempts)
    .where(and(eq(autopayAttempts.userId, userId), eq(autopayAttempts.cycleKey, cycleKey)));
}

/**
 * The shape every attempt row shares. `cycleKey` defaults to the current
 * calendar cycle; a retry that rolled into next month passes its BASE cycle
 * (isRetryDay), or the durable per-cycle guard would break.
 */
function attemptBase({ enrollment, doctor, runId, now, dryRun, cycleKey }) {
  return {
    id: createId(),
    enrollmentId: enrollment.id,
    userId: doctor.id,
    jobRunId: runId || null,
    cycleKey: cycleKey || cycleKeyFor(now, env.AUTOPAY_TIMEZONE),
    scheduledFor: labDateFor(now, env.AUTOPAY_TIMEZONE),
    dryRun: Boolean(dryRun),
  };
}

/** Guarded attempt insert: processEnrollment promises never to throw, even if the record of an outcome fails. */
async function writeAttempt(row, log) {
  try {
    await db.insert(autopayAttempts).values(row);
  } catch (err) {
    log?.error?.({ err, attempt: row }, "[AutoPay] failed to write autopay_attempts row — the outcome above happened but was not durably recorded");
  }
  return row;
}

/** Guarded enrollment update, same contract as writeAttempt. */
async function updateEnrollment(id, patch, log) {
  try {
    await db.update(autopayEnrollments).set(patch).where(eq(autopayEnrollments.id, id));
  } catch (err) {
    log?.error?.({ err, enrollmentId: id, patch }, "[AutoPay] failed to update autopay_enrollments row");
  }
}

/**
 * A doctor's open invoices from our ledger. A read failure must NOT become
 * "nothing owed" (which would complete the enrollment) or "nothing paid"
 * (which would overcharge): it is its own outcome. kind: "ok" | "ledger_error".
 */
async function resolveOpenInvoices(doctor) {
  try {
    // The enrolled doctor's practice-wide open invoices (canActOnInvoice).
    return { kind: "ok", invoices: await openInvoicesForClient(doctor) };
  } catch (err) {
    return { kind: "ledger_error", error: err };
  }
}

/**
 * Run one enrollment for one cycle. Returns the attempt row it wrote. Never
 * throws: one doctor's failure must not abort the sweep.
 * @param {Array<{ id, invoiceNumber, balanceCents, dueDate }>} invoices
 */
export async function processEnrollment({ enrollment, doctor, invoices, dryRun: requestedDryRun, now, runId, log, cycleKey }) {
  // Cutover freeze (middleware/payments-paused.js flag): no card is charged while payments are paused.
  const dryRun = requestedDryRun || env.PAYMENTS_PAUSED === true;
  const base = attemptBase({ enrollment, doctor, runId, now, dryRun, cycleKey });

  try {
    // Fail closed: a balance that is not integer cents (a corrupt or foreign
    // row) must never be summed into a charge. No charge, no failure count.
    if ((invoices || []).some((i) => !Number.isSafeInteger(i.balanceCents))) {
      return writeAttempt({ ...base, status: "failed", failureReason: "an open invoice has a non-integer balance; nothing charged" }, log);
    }
    const totalBalanceCents = (invoices || []).reduce((s, i) => s + i.balanceCents, 0);
    const chargeCents = resolveChargeCents({ enrolledCents: toCents(enrollment.amount), totalBalanceCents });

    if (chargeCents <= 0) {
      // Nothing owed: stop charging. `completed` is recoverable (see below). A
      // dry run only records what it would do; it never moves the lifecycle.
      if (!dryRun) await updateEnrollment(enrollment.id, { status: "completed", lastRunAt: now, updatedAt: now }, log);
      return writeAttempt({ ...base, status: "skipped", failureReason: "no outstanding balance" }, log);
    }

    // A completed enrollment that owes again resumes automatically.
    if (enrollment.status === "completed" && !dryRun) {
      await updateEnrollment(enrollment.id, { status: "active", updatedAt: now }, log);
    }

    const { allocations, totalAllocatedCents } = allocateOldestFirst(invoices, chargeCents);
    const amountAttempted = toDecimalString(totalAllocatedCents);

    if (dryRun) {
      return writeAttempt({ ...base, status: "would_charge", amountAttempted, allocations }, log);
    }

    try {
      // Same nesting as the doctor's charge-saved route: the idempotency key
      // serializes retries of THIS enrollment+cycle; the invoice locks
      // serialize against any other payment on the same invoices.
      // Known crash window (lib/payment-helpers.js): the result cache is written
      // after the charge and the record; a process death in between can let a
      // retry 2 minutes to 1 hour later charge again. Accepted, documented risk.
      const idem = await withIdempotency(
        redis,
        `autopay:${enrollment.id}:${base.cycleKey}`,
        () =>
          withInvoiceLocks(
            redis,
            allocations.map((a) => a.invoiceId),
            async () => {
              // C2: the durable per-cycle guard, fresh, right before the gateway.
              const cycleAttempts = await attemptsThisCycle(doctor.id, base.cycleKey);
              if (cycleAttempts.some((a) => a.status === "succeeded" && a.dryRun === false)) {
                throw new AlreadyChargedThisCycleError();
              }

              // I3 cap re-check INSIDE the lock, the charge and the ledger write:
              // the same implementation the doctor and admin saved-card routes use.
              try {
                return await chargeSavedCardAndRecord({
                  payer: doctor,
                  customerProfileId: doctor.authorizeNetCustomerProfileId,
                  paymentProfileId: enrollment.paymentProfileId,
                  amountCents: totalAllocatedCents,
                  allocations,
                  source: "autopay",
                });
              } catch (err) {
                if (err.allocationError) throw new AllocationCapExceededError(err.allocationError.message, err.allocationError.kind);
                throw err;
              }
            },
            { log }
          ),
        { log }
      );

      // On replay, fn never ran: neither the gateway nor the ledger was touched again.
      const transactionId = idem.result?.transactionId ?? null;
      // The card was charged but the ledger write failed: the money moved, so the
      // attempt stays `succeeded`, but the balance still looks owed. Pause the
      // enrollment so the next cycle cannot charge the same balance again.
      if (idem.result?.ledgerWriteFailed) {
        await updateEnrollment(
          enrollment.id,
          { lastRunAt: now, lastChargedAt: now, consecutiveFailures: 0, status: "paused", pausedReason: "ledger_write_failed", updatedAt: now },
          log
        );
        log?.error?.(
          { enrollmentId: enrollment.id, userId: doctor.id, transactionId },
          "[AutoPay][LEDGER_WRITE_FAILED] charge captured but the ledger write failed — enrollment paused until reconciled"
        );
        return writeAttempt(
          { ...base, status: "succeeded", amountAttempted, amountCharged: amountAttempted, transactionId, allocations, failureReason: "ledger_write_failed" },
          log
        );
      }
      await updateEnrollment(enrollment.id, { lastRunAt: now, lastChargedAt: now, consecutiveFailures: 0, updatedAt: now }, log);
      return writeAttempt(
        { ...base, status: "succeeded", amountAttempted, amountCharged: amountAttempted, transactionId, allocations },
        log
      );
    } catch (err) {
      if (err instanceof AlreadyChargedThisCycleError) {
        return writeAttempt({ ...base, status: "skipped", failureReason: "already charged this cycle" }, log);
      }

      // The in-lock check failed: an internal race, not the card. No failure
      // count, no decline email.
      if (err instanceof AllocationCapExceededError) {
        await updateEnrollment(enrollment.id, { lastRunAt: now, updatedAt: now }, log);
        const failureReason = err.kind === "forbidden"
          ? `could not verify allocation before charging: ${String(err.message).slice(0, 400)}`
          : String(err.message).slice(0, 500);
        return writeAttempt({ ...base, status: "failed", amountAttempted, allocations, failureReason }, log);
      }

      // A fraud hold that could not be released may still be captured: never
      // retry it. Recorded `skipped` (retries fire only on `failed`), the
      // enrollment paused until a human reconciles it; the lock helpers keep
      // their locks for the pending window.
      if (isGatewayOutcomePending(err)) {
        await updateEnrollment(enrollment.id, { lastRunAt: now, status: "paused", pausedReason: "gateway_outcome_pending", updatedAt: now }, log);
        log?.error?.(
          { enrollmentId: enrollment.id, userId: doctor.id, transactionId: err.transactionId || null },
          "[AutoPay][GATEWAY_OUTCOME_PENDING] charge held for review and could not be released — enrollment paused, not retried"
        );
        return writeAttempt(
          {
            ...base, status: "skipped", amountAttempted,
            transactionId: err.transactionId ? String(err.transactionId) : null, allocations,
            failureReason: "charge held for fraud review and could not be released — outcome pending at the gateway; not retried, enrollment paused until reconciled",
          },
          log
        );
      }

      // Another payment holds this enrollment's key or one of the invoices:
      // nothing reached the card. `failed` so the retry day can try again,
      // but no failure count and no decline email.
      if (err instanceof ChargeInProgressError || err instanceof InvoiceLockedError) {
        await updateEnrollment(enrollment.id, { lastRunAt: now, updatedAt: now }, log);
        return writeAttempt(
          { ...base, status: "failed", amountAttempted, allocations, failureReason: `not charged — another charge is in progress for these invoices: ${String(err.message).slice(0, 400)}` },
          log
        );
      }

      const failures = Number(enrollment.consecutiveFailures || 0) + 1;
      const shouldPause = failures >= Number(env.AUTOPAY_MAX_FAILURES);
      await updateEnrollment(
        enrollment.id,
        { lastRunAt: now, consecutiveFailures: failures, ...(shouldPause ? { status: "paused", pausedReason: "consecutive_failures" } : {}), updatedAt: now },
        log
      );
      // Notify, soft-fail (the email takes dollars).
      await Promise.resolve()
        .then(() => emailService.sendAutopayFailure({
          email: doctor.email, name: doctor.name, amountCents: totalAllocatedCents, reason: err?.message || "Card declined", paused: shouldPause,
        }))
        .catch(() => {});
      return writeAttempt(
        { ...base, status: "failed", amountAttempted, allocations, failureReason: String(err?.message || err).slice(0, 500) },
        log
      );
    }
  } catch (err) {
    // Final safety net: a genuine bug still returns an attempt-shaped object.
    log?.error?.({ err, enrollmentId: enrollment?.id }, "[AutoPay] processEnrollment hit an unexpected error");
    return writeAttempt({ ...base, status: "failed", failureReason: `unexpected error: ${String(err?.message || err).slice(0, 450)}` }, log);
  }
}

/** Sweep every enrollment due today. */
export async function runAutopaySweep({ dryRun = true, now = new Date(), log, runId } = {}) {
  const rows = await db
    .select({
      enrollment: autopayEnrollments,
      doctor: {
        id: users.id,
        email: users.email,
        name: users.name,
        // The practice key: AutoPay pays what the doctor may pay (canActOnInvoice).
        seazonaClientId: users.seazonaClientId,
        authorizeNetCustomerProfileId: users.authorizeNetCustomerProfileId,
      },
    })
    .from(autopayEnrollments)
    .innerJoin(users, eq(users.id, autopayEnrollments.userId))
    .where(
      and(
        eq(autopayEnrollments.enabled, true),
        // `completed` is recoverable: a paid-off doctor may owe again.
        or(eq(autopayEnrollments.status, "active"), eq(autopayEnrollments.status, "completed"))
      )
    );

  const currentCycleKey = cycleKeyFor(now, env.AUTOPAY_TIMEZONE);

  // I4: due on the charge day, or on a decline retry day (charge day + 2 / + 5)
  // when this cycle already has a real failed attempt. Each due row carries its
  // BASE cycle (a retry can roll into next month).
  const due = [];
  for (const row of rows) {
    const { enrollment } = row;
    if (isDueOn(enrollment.dayOfMonth, now, env.AUTOPAY_TIMEZONE)) {
      due.push({ ...row, cycleKey: currentCycleKey });
      continue;
    }
    const retry = isRetryDay(enrollment.dayOfMonth, now, env.AUTOPAY_TIMEZONE);
    if (retry) {
      const cycleAttempts = await attemptsThisCycle(enrollment.userId, retry.cycleKey);
      if (cycleAttempts.some((a) => a.status === "failed" && a.dryRun === false)) due.push({ ...row, cycleKey: retry.cycleKey });
    }
  }

  const summary = { considered: due.length, charged: 0, skipped: 0, failed: 0, wouldCharge: 0, totalAmount: 0 };
  let totalCents = 0;

  for (const { enrollment, doctor, cycleKey: baseCycleKey } of due) {
    try {
      const resolved = await resolveOpenInvoices(doctor);
      if (resolved.kind === "ledger_error") {
        await writeAttempt(
          { ...attemptBase({ enrollment, doctor, runId, now, dryRun, cycleKey: baseCycleKey }), status: "failed", failureReason: "could not determine balance — ledger read failed" },
          log
        );
        summary.failed++;
        continue;
      }
      const attempt = await processEnrollment({
        enrollment, doctor, invoices: resolved.invoices, dryRun, now, runId, log, cycleKey: baseCycleKey,
      });
      if (attempt.status === "succeeded") {
        summary.charged++;
        totalCents += toCents(attempt.amountCharged);
      } else if (attempt.status === "would_charge") {
        summary.wouldCharge++;
        totalCents += toCents(attempt.amountAttempted);
      } else if (attempt.status === "failed") {
        summary.failed++;
      } else {
        summary.skipped++;
      }
    } catch (err) {
      // processEnrollment doesn't throw, but one doctor must never abort the sweep.
      summary.failed++;
      log?.error?.({ err, enrollmentId: enrollment.id }, "autopay enrollment threw outside processEnrollment");
    }
  }

  // Job summaries stay in dollars (AdminJobsPage renders totalAmount as money).
  summary.totalAmount = totalCents / 100;
  return summary;
}
