import { db } from "../config/database.js";
import { redis } from "../config/redis.js";
import { autopayEnrollments, autopayAttempts, users } from "../db/schema/index.js";
import { eq, and } from "drizzle-orm";
import { createId } from "../lib/id.js";
import { env } from "../config/env.js";
import * as seazonaService from "./seazona.service.js";
import * as authorizenetService from "./authorizenet.service.js";
import { getPortalPaidMap } from "./invoice-ledger.service.js";
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

/** Open invoices for a doctor with balances from the LOCAL ledger. */
async function openInvoicesFor(doctor) {
  const [invoices, paidMap] = await Promise.all([
    seazonaService.getInvoices("1900-01-01T00:00:00Z"),
    getPortalPaidMap(doctor.id),
  ]);
  return (invoices || [])
    .filter((inv) => String(inv.clientId) === String(doctor.seazonaClientId))
    .map((inv) => ({
      id: String(inv.id),
      invoiceNumber: inv.invoiceNumber != null ? String(inv.invoiceNumber) : null,
      balance: round2(Number(inv.total || 0) - Number(paidMap[String(inv.id)] || 0)),
      dueDate: inv.due || null,
    }))
    .filter((inv) => inv.balance > 0);
}

/**
 * Run one enrollment for one cycle. Returns the attempt row it wrote.
 * Never throws — a single doctor's failure must not abort the sweep.
 */
export async function processEnrollment({ enrollment, doctor, invoices, dryRun, now, runId, log }) {
  const cycleKey = cycleKeyFor(now, env.AUTOPAY_TIMEZONE);
  const scheduledFor = now.toISOString().slice(0, 10);

  const base = {
    id: createId(),
    enrollmentId: enrollment.id,
    userId: doctor.id,
    jobRunId: runId || null,
    cycleKey,
    scheduledFor,
    dryRun: Boolean(dryRun),
  };

  const write = async (row) => {
    await db.insert(autopayAttempts).values(row);
    return row;
  };

  const totalBalance = round2((invoices || []).reduce((s, i) => s + i.balance, 0));
  const chargeAmount = resolveChargeAmount({ enrolledAmount: Number(enrollment.amount), totalBalance });

  if (chargeAmount <= 0) {
    // Nothing owed — the doctor has paid off. Stop charging them.
    await db
      .update(autopayEnrollments)
      .set({ status: "completed", lastRunAt: now, updatedAt: now })
      .where(eq(autopayEnrollments.id, enrollment.id));
    return write({ ...base, status: "skipped", failureReason: "no outstanding balance" });
  }

  const { allocations, totalAllocated } = allocateOldestFirst(invoices, chargeAmount);

  if (dryRun) {
    return write({
      ...base,
      status: "would_charge",
      amountAttempted: totalAllocated.toFixed(2),
      allocations,
    });
  }

  try {
    // withIdempotency wraps withInvoiceLocks — same nesting order as the
    // doctor-facing /payments/charge-saved route (payment.routes.js): the
    // idempotency key serializes retries of THIS enrollment+cycle, the
    // invoice locks serialize against any OTHER charge (portal or autopay)
    // touching the same invoices concurrently.
    const idem = await withIdempotency(
      redis,
      `autopay:${enrollment.id}:${cycleKey}`,
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

    // withIdempotency returns { result, replayed, cacheWriteFailed } — `result`
    // is whatever the wrapped fn resolved to (the merged charge object above),
    // never the charge itself. On replay `fn` never ran, so neither the
    // gateway nor recordPaymentAndAllocations was called a second time.
    const transactionId = idem.result?.transactionId ?? null;

    await db
      .update(autopayEnrollments)
      .set({ lastRunAt: now, lastChargedAt: now, consecutiveFailures: 0, updatedAt: now })
      .where(eq(autopayEnrollments.id, enrollment.id));

    return write({
      ...base,
      status: "succeeded",
      amountAttempted: totalAllocated.toFixed(2),
      amountCharged: totalAllocated.toFixed(2),
      transactionId,
      allocations,
    });
  } catch (err) {
    const failures = Number(enrollment.consecutiveFailures || 0) + 1;
    const shouldPause = failures >= Number(env.AUTOPAY_MAX_FAILURES);

    await db
      .update(autopayEnrollments)
      .set({
        lastRunAt: now,
        consecutiveFailures: failures,
        ...(shouldPause ? { status: "paused", pausedReason: "consecutive_failures" } : {}),
        updatedAt: now,
      })
      .where(eq(autopayEnrollments.id, enrollment.id));

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

    return write({
      ...base,
      status: "failed",
      amountAttempted: totalAllocated.toFixed(2),
      allocations,
      failureReason: String(err?.message || err).slice(0, 500),
    });
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
    .where(and(eq(autopayEnrollments.enabled, true), eq(autopayEnrollments.status, "active")));

  const due = rows.filter(({ enrollment }) => isDueOn(enrollment.dayOfMonth, now, env.AUTOPAY_TIMEZONE));

  const summary = { considered: due.length, charged: 0, skipped: 0, failed: 0, wouldCharge: 0, totalAmount: 0 };

  for (const { enrollment, doctor } of due) {
    // Serialized on purpose — Seazona rate-limits hard (concurrency 8 failed
    // 448/476 requests). Do not Promise.all this loop.
    await sleep(SEAZONA_SPACING_MS);
    try {
      const invoices = await openInvoicesFor(doctor);
      const attempt = await processEnrollment({ enrollment, doctor, invoices, dryRun, now, runId, log });
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
      // violated (e.g. openInvoicesFor itself throws).
      summary.failed++;
      log?.error?.({ err, enrollmentId: enrollment.id }, "autopay enrollment threw outside processEnrollment");
    }
  }

  return summary;
}
