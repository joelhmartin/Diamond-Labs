import { db } from "../config/database.js";
import { redis } from "../config/redis.js";
import { autopayEnrollments, autopayAttempts, users } from "../db/schema/index.js";
import { eq, and, or } from "drizzle-orm";
import { createId } from "../lib/id.js";
import { env } from "../config/env.js";
import * as seazonaService from "./seazona.service.js";
import * as authorizenetService from "./authorizenet.service.js";
import { getPortalPaidMapStrict } from "./invoice-ledger.service.js";
import { recordPaymentAndAllocations } from "./payment-recording.service.js";
import { allocateOldestFirst, resolveChargeAmount } from "../lib/autopay-allocation.js";
import { isDueOn, cycleKeyFor } from "../lib/autopay-schedule.js";
import { withInvoiceLocks, withIdempotency } from "../lib/payment-helpers.js";
import * as emailService from "./email.service.js";

/** Seazona rate-limits hard: concurrency 8 failed 448/476. Serial + spaced. */
const SEAZONA_SPACING_MS = 110;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** The base shape every attempt row shares, before its outcome-specific fields. */
function attemptBase({ enrollment, doctor, runId, now, dryRun }) {
  return {
    id: createId(),
    enrollmentId: enrollment.id,
    userId: doctor.id,
    jobRunId: runId || null,
    cycleKey: cycleKeyFor(now, env.AUTOPAY_TIMEZONE),
    scheduledFor: now.toISOString().slice(0, 10),
    dryRun: Boolean(dryRun),
  };
}

/**
 * Guarded attempt insert. `processEnrollment` promises never to throw — a
 * future direct caller (e.g. an admin "charge now" action) needs that promise
 * to hold even if the DURABLE RECORD of an outcome fails to write, not just
 * the outcome itself. Logs loudly (the row that failed to write is in the log
 * line) and still hands back the attempt-shaped object.
 */
async function writeAttempt(row, log) {
  try {
    await db.insert(autopayAttempts).values(row);
  } catch (err) {
    log?.error?.(
      { err, attempt: row },
      "[AutoPay] failed to write autopay_attempts row — the outcome above happened but was not durably recorded"
    );
  }
  return row;
}

/** Guarded enrollment update — same "never throws" contract as writeAttempt. */
async function updateEnrollment(id, patch, log) {
  try {
    await db.update(autopayEnrollments).set(patch).where(eq(autopayEnrollments.id, id));
  } catch (err) {
    log?.error?.({ err, enrollmentId: id, patch }, "[AutoPay] failed to update autopay_enrollments row");
  }
}

/**
 * Resolve a doctor's open invoices with balances from the LOCAL ledger.
 *
 * Returns a discriminated result rather than a bare array so the sweep can
 * tell "genuinely nothing owed" apart from "we couldn't find out" — a plain
 * empty array reads identically to a paid-off balance either way, and both
 * failure modes are dangerous if mistaken for one:
 *   - a ledger-read blip (getPortalPaidMapStrict throwing) must NOT fall back
 *     to "paid so far = 0", which would reopen every invoice's FULL total and
 *     let the sweep charge for invoices that are already paid;
 *   - a Seazona outage (unreachable) must NOT read as "zero invoices", which
 *     would mark the enrollment `completed` with no balance ever checked —
 *     and (before this fix) `completed` had no path back to `active`, so one
 *     blip on sweep day permanently disabled AutoPay for that doctor.
 *
 * kind: "ok" | "seazona_unreachable" | "ledger_error"
 */
async function resolveOpenInvoices(doctor) {
  const { reachable, invoices } = await seazonaService.getInvoicesResult("1900-01-01T00:00:00Z");
  if (!reachable) {
    return { kind: "seazona_unreachable" };
  }

  let paidMap;
  try {
    paidMap = await getPortalPaidMapStrict(doctor.id);
  } catch (err) {
    return { kind: "ledger_error", error: err };
  }

  const openInvoices = (invoices || [])
    .filter((inv) => String(inv.clientId) === String(doctor.seazonaClientId))
    .map((inv) => ({
      id: String(inv.id),
      invoiceNumber: inv.invoiceNumber != null ? String(inv.invoiceNumber) : null,
      balance: round2(Number(inv.total || 0) - Number(paidMap[String(inv.id)] || 0)),
      dueDate: inv.due || null,
    }))
    .filter((inv) => inv.balance > 0);

  return { kind: "ok", invoices: openInvoices };
}

/**
 * Run one enrollment for one cycle. Returns the attempt row it wrote.
 * Never throws — a single doctor's failure must not abort the sweep, and
 * (per the guarded writes above) not even a failure to WRITE that failure
 * escapes this function.
 */
export async function processEnrollment({ enrollment, doctor, invoices, dryRun, now, runId, log }) {
  const base = attemptBase({ enrollment, doctor, runId, now, dryRun });

  try {
    const totalBalance = round2((invoices || []).reduce((s, i) => s + i.balance, 0));
    const chargeAmount = resolveChargeAmount({ enrolledAmount: Number(enrollment.amount), totalBalance });

    if (chargeAmount <= 0) {
      // Nothing owed — the doctor has paid off. Stop charging them. `completed`
      // is not permanent: see the reactivation branch below.
      await updateEnrollment(enrollment.id, { status: "completed", lastRunAt: now, updatedAt: now }, log);
      return writeAttempt({ ...base, status: "skipped", failureReason: "no outstanding balance" }, log);
    }

    // A previously-completed enrollment owes money again (new invoices since
    // it was paid off). `completed` means "nothing owed at last check", not
    // "permanently done" — a doctor who pays off in full and later receives
    // new invoices must resume AutoPay automatically, not stay silently
    // disabled forever. Flip the status regardless of whether THIS charge
    // attempt goes on to succeed or fail — the enrollment is genuinely
    // active again either way.
    if (enrollment.status === "completed") {
      await updateEnrollment(enrollment.id, { status: "active", updatedAt: now }, log);
    }

    const { allocations, totalAllocated } = allocateOldestFirst(invoices, chargeAmount);

    if (dryRun) {
      return writeAttempt(
        { ...base, status: "would_charge", amountAttempted: totalAllocated.toFixed(2), allocations },
        log
      );
    }

    try {
      // withIdempotency wraps withInvoiceLocks — same nesting order as the
      // doctor-facing /payments/charge-saved route (payment.routes.js): the
      // idempotency key serializes retries of THIS enrollment+cycle, the
      // invoice locks serialize against any OTHER charge (portal or autopay)
      // touching the same invoices concurrently.
      //
      // Known crash window (inherited from lib/payment-helpers.js, not fixed
      // here): the result cache is written only AFTER the charge and
      // recordPaymentAndAllocations both complete, but the in-flight LOCK's
      // TTL is 120s while the job-level lock in jobs/runner.js is 1h. If this
      // process dies between the charge landing and the cache write (Cloud
      // Run OOM/timeout), a retry 2 minutes to 1 hour later has no memory of
      // the charge and can charge again. Accepted risk, not re-architected
      // in this task — flagged here so it stays a known risk, not a silent one.
      const idem = await withIdempotency(
        redis,
        `autopay:${enrollment.id}:${base.cycleKey}`,
        () =>
          withInvoiceLocks(
            redis,
            allocations.map((a) => a.invoiceId),
            async () => {
              const charge = await authorizenetService.chargeCustomerProfile({
                customerProfileId: doctor.authorizeNetCustomerProfileId,
                paymentProfileId: enrollment.paymentProfileId,
                amount: totalAllocated,
                invoiceNumber: allocations[0]?.invoiceNumber,
              });
              const { seazonaPaymentId } = await recordPaymentAndAllocations({
                user: doctor,
                amount: totalAllocated,
                transactionId: charge.transactionId,
                allocations,
                source: "autopay",
              });
              return { ...charge, seazonaPaymentId };
            },
            { log }
          ),
        { log }
      );

      // withIdempotency returns { result, replayed, cacheWriteFailed } —
      // `result` is whatever the wrapped fn resolved to (the merged charge
      // object above), never the charge itself. On replay `fn` never ran, so
      // neither the gateway nor recordPaymentAndAllocations was called again.
      const transactionId = idem.result?.transactionId ?? null;

      await updateEnrollment(
        enrollment.id,
        { lastRunAt: now, lastChargedAt: now, consecutiveFailures: 0, updatedAt: now },
        log
      );

      return writeAttempt(
        {
          ...base,
          status: "succeeded",
          amountAttempted: totalAllocated.toFixed(2),
          amountCharged: totalAllocated.toFixed(2),
          transactionId,
          allocations,
        },
        log
      );
    } catch (err) {
      const failures = Number(enrollment.consecutiveFailures || 0) + 1;
      const shouldPause = failures >= Number(env.AUTOPAY_MAX_FAILURES);

      await updateEnrollment(
        enrollment.id,
        {
          lastRunAt: now,
          consecutiveFailures: failures,
          ...(shouldPause ? { status: "paused", pausedReason: "consecutive_failures" } : {}),
          updatedAt: now,
        },
        log
      );

      // Notify, soft-fail — an email problem must not mask the payment failure.
      // sendAutopayFailure does not exist yet (Task 13 adds it); guard so this
      // module doesn't crash at call time in the meantime — importing * as
      // emailService never throws on a missing named export, only calling one
      // would.
      if (typeof emailService.sendAutopayFailure === "function") {
        await emailService
          .sendAutopayFailure({
            email: doctor.email,
            name: doctor.name,
            amount: totalAllocated,
            reason: err?.message || "Card declined",
            paused: shouldPause,
          })
          .catch(() => {});
      }

      return writeAttempt(
        {
          ...base,
          status: "failed",
          amountAttempted: totalAllocated.toFixed(2),
          allocations,
          failureReason: String(err?.message || err).slice(0, 500),
        },
        log
      );
    }
  } catch (err) {
    // Final safety net. Everything above this point either can't throw for
    // well-formed input or is itself guarded (writeAttempt/updateEnrollment
    // never throw); this exists so a genuine bug — bad allocation math, a
    // schedule-lib exception, malformed input — still returns an
    // attempt-shaped object instead of an unhandled rejection. A future
    // direct caller of processEnrollment (an admin "charge now" button) would
    // have no sweep-level try/catch of its own to fall back on.
    log?.error?.({ err, enrollmentId: enrollment?.id }, "[AutoPay] processEnrollment hit an unexpected error");
    return writeAttempt(
      { ...base, status: "failed", failureReason: `unexpected error: ${String(err?.message || err).slice(0, 450)}` },
      log
    );
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
        seazonaClientId: users.seazonaClientId,
        seazonaAccountNumber: users.seazonaAccountNumber,
        authorizeNetCustomerProfileId: users.authorizeNetCustomerProfileId,
      },
    })
    .from(autopayEnrollments)
    .innerJoin(users, eq(users.id, autopayEnrollments.userId))
    .where(
      and(
        eq(autopayEnrollments.enabled, true),
        // `completed` is recoverable (see the reactivation branch in
        // processEnrollment) — a doctor who paid off in full may receive new
        // invoices later and must be swept again, not excluded forever.
        or(eq(autopayEnrollments.status, "active"), eq(autopayEnrollments.status, "completed"))
      )
    );

  const due = rows.filter(({ enrollment }) => isDueOn(enrollment.dayOfMonth, now, env.AUTOPAY_TIMEZONE));

  const summary = { considered: due.length, charged: 0, skipped: 0, failed: 0, wouldCharge: 0, totalAmount: 0 };

  for (const { enrollment, doctor } of due) {
    // Serialized on purpose — Seazona rate-limits hard (concurrency 8 failed
    // 448/476 requests). Do not Promise.all this loop.
    await sleep(SEAZONA_SPACING_MS);
    try {
      const resolved = await resolveOpenInvoices(doctor);

      if (resolved.kind === "seazona_unreachable") {
        // Never infer a zero balance from an unreachable upstream — leave
        // enrollment status untouched and charge nothing.
        await writeAttempt(
          {
            ...attemptBase({ enrollment, doctor, runId, now, dryRun }),
            status: "skipped",
            failureReason: "Seazona unreachable",
          },
          log
        );
        summary.skipped++;
        continue;
      }

      if (resolved.kind === "ledger_error") {
        // Never fall back to "paid so far = 0" — that would reopen every
        // invoice's full total and overcharge an already-paid balance.
        await writeAttempt(
          {
            ...attemptBase({ enrollment, doctor, runId, now, dryRun }),
            status: "failed",
            failureReason: "could not determine balance — ledger read failed",
          },
          log
        );
        summary.failed++;
        continue;
      }

      const attempt = await processEnrollment({
        enrollment,
        doctor,
        invoices: resolved.invoices,
        dryRun,
        now,
        runId,
        log,
      });
      if (attempt.status === "succeeded") {
        summary.charged++;
        summary.totalAmount = round2(summary.totalAmount + Number(attempt.amountCharged));
      } else if (attempt.status === "would_charge") {
        summary.wouldCharge++;
        summary.totalAmount = round2(summary.totalAmount + Number(attempt.amountAttempted));
      } else if (attempt.status === "failed") {
        summary.failed++;
      } else {
        summary.skipped++;
      }
    } catch (err) {
      // processEnrollment is written not to throw, but a single doctor's
      // failure must never abort the sweep even if that contract is somehow
      // violated (e.g. resolveOpenInvoices itself throws in some new way).
      summary.failed++;
      log?.error?.({ err, enrollmentId: enrollment.id }, "autopay enrollment threw outside processEnrollment");
    }
  }

  return summary;
}
