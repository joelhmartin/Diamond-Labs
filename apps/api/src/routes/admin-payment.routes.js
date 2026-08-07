import { authenticate } from "../middleware/authenticate.js";
import { requireAdmin } from "../middleware/require-role.js";
import { validate } from "../middleware/validate.js";
import { autopayAdminEnrollSchema, chargeSavedSchema, ERROR_CODES } from "@my-app/shared";
import * as autopayService from "../services/autopay.service.js";
import * as authorizenetService from "../services/authorizenet.service.js";
import { ensureCustomerProfile, listCardsForUser } from "../services/card.service.js";
import * as auditService from "../services/audit.service.js";
import { db } from "../config/database.js";
import { redis } from "../config/redis.js";
import { users, autopayEnrollments, jobRuns } from "../db/schema/index.js";
import { eq, desc } from "drizzle-orm";
import { env } from "../config/env.js";
import { listJobs } from "../jobs/registry.js";
import { runJob, JobLockedError } from "../jobs/runner.js";
import {
  verifyAllocations,
  recordPaymentAndAllocations,
} from "../services/payment-recording.service.js";
import {
  sendAllocationError,
  sendInvoiceLockedError,
  chargeErrorReply,
} from "./payment.routes.js";
import {
  withIdempotency,
  ChargeInProgressError,
  withInvoiceLocks,
  InvoiceLockedError,
} from "../lib/payment-helpers.js";

class DoctorNotFoundError extends Error {}

// Per-route strict rate limit for the one charge-producing endpoint in this
// file — mirrors payment.routes.js's CHARGE_RATE_LIMIT so an admin acting on
// behalf of many doctors can't hammer the gateway any harder than a doctor
// charging their own card could.
const ADMIN_CHARGE_RATE_LIMIT = { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } };

/**
 * Load the doctor an admin is acting on behalf of. Returns the same shape
 * `authenticate` puts on request.user, so every downstream helper
 * (ensureCustomerProfile, listCardsForUser, verifyAllocations) works unchanged.
 *
 * I8 — every route in this file trusts this to have already confirmed the
 * target IS a doctor. Before this, `loadDoctor` validated only that a row
 * with this id existed — `POST /admin/users/:userId/payments/charge-saved`
 * was the only charge path with no approved-doctor predicate on the payer,
 * and the enroll route would have happily enrolled another admin (or a
 * plain `user`) in recurring charges, relying entirely on the frontend
 * gating its user picker to `role === "doctor"`. Reject any non-doctor
 * target with the SAME `DoctorNotFoundError` a missing id produces — a 404,
 * not a 403 — so the response never leaks which ids exist versus which ids
 * exist but aren't doctors.
 */
async function loadDoctor(userId) {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      approvalStatus: users.approvalStatus,
      seazonaClientId: users.seazonaClientId,
      seazonaAccountNumber: users.seazonaAccountNumber,
      authorizeNetCustomerProfileId: users.authorizeNetCustomerProfileId,
      defaultPaymentProfileId: users.defaultPaymentProfileId,
    })
    .from(users)
    .where(eq(users.id, String(userId)))
    .limit(1);
  if (!row || row.role !== "doctor") throw new DoctorNotFoundError();
  return row;
}

const guard = [authenticate, requireAdmin];

export default async function adminPaymentRoutes(fastify) {
  const notFound = (reply) =>
    reply.code(404).send({ error: { ...ERROR_CODES.NOT_FOUND, message: "Doctor not found." } });

  // 502 helper for a gateway failure — used everywhere a card.service /
  // authorizenet.service call can fail for reasons that have nothing to do
  // with the doctor's actual card state (network error, stale
  // customerProfileId, transient Authorize.net error). Reporting a gateway
  // hiccup as "no cards on file" or a plain 500 would either mislead an admin
  // into adding a duplicate card or hide a real outage behind a generic error.
  const gatewayErrorResponse = (reply) =>
    reply.code(502).send({
      error: {
        ...ERROR_CODES.PAYMENT_GATEWAY_ERROR,
        message: "Could not reach the card processor. Please try again shortly.",
      },
    });

  // ── AutoPay oversight ──
  fastify.get("/admin/autopay", { preHandler: guard }, async () => {
    const rows = await db
      .select({
        userId: autopayEnrollments.userId,
        enabled: autopayEnrollments.enabled,
        amount: autopayEnrollments.amount,
        dayOfMonth: autopayEnrollments.dayOfMonth,
        status: autopayEnrollments.status,
        pausedReason: autopayEnrollments.pausedReason,
        consecutiveFailures: autopayEnrollments.consecutiveFailures,
        minAmountOverride: autopayEnrollments.minAmountOverride,
        lastChargedAt: autopayEnrollments.lastChargedAt,
        doctorName: users.name,
        doctorEmail: users.email,
        accountNumber: users.seazonaAccountNumber,
      })
      .from(autopayEnrollments)
      .leftJoin(users, eq(users.id, autopayEnrollments.userId))
      .orderBy(desc(autopayEnrollments.updatedAt));
    return { data: { enrollments: rows, minAmount: Number(env.AUTOPAY_MIN_AMOUNT), liveRun: env.AUTOPAY_LIVE_RUN } };
  });

  fastify.get("/admin/users/:userId/autopay", { preHandler: guard }, async (request, reply) => {
    try {
      const doctor = await loadDoctor(request.params.userId);
      const enrollment = await autopayService.getEnrollment(doctor.id);

      // listCardsForUser hits Authorize.net and can throw on a gateway failure,
      // as distinct from a doctor who legitimately has no cards on file (that's
      // a `[]`, not a throw — see card.service.js). Conflating the two would
      // render a transient outage as "you have no cards on file" to the admin.
      let cards = [];
      let cardsUnavailable = false;
      try {
        cards = await listCardsForUser(doctor);
      } catch (err) {
        request.log.warn({ err, userId: doctor.id }, "[AdminPayments] listCardsForUser failed");
        cardsUnavailable = true;
      }

      return {
        data: {
          enrollment,
          cards,
          cardsUnavailable,
          canEnroll: !cardsUnavailable && cards.length > 0,
        },
      };
    } catch (err) {
      if (err instanceof DoctorNotFoundError) return notFound(reply);
      throw err;
    }
  });

  fastify.put("/admin/users/:userId/autopay", {
    preHandler: [...guard, validate(autopayAdminEnrollSchema)],
  }, async (request, reply) => {
    try {
      const doctor = await loadDoctor(request.params.userId);
      // I8 — enrolling a doctor whose registration was never approved (or was
      // rejected) in recurring charges makes no sense; treat it the same as a
      // missing/non-doctor target rather than a distinct error that would
      // confirm the id belongs to a real, pending account.
      if (doctor.approvalStatus !== "approved") return notFound(reply);
      const enrollment = await autopayService.upsertEnrollment({
        user: doctor,
        ...request.body,
        actorUserId: request.user.id,
      });
      await auditService.logSafe({
        userId: request.user.id,
        action: "autopay.enrollment_updated_by_admin",
        targetType: "user",
        targetId: doctor.id,
        metadata: {
          amount: request.body.amount,
          dayOfMonth: request.body.dayOfMonth,
          enabled: enrollment.enabled,
          minAmountOverride: request.body.minAmountOverride ?? null,
        },
        ipAddress: request.ip,
      });
      return { data: { enrollment } };
    } catch (err) {
      if (err instanceof DoctorNotFoundError) return notFound(reply);
      if (err instanceof autopayService.AutopayValidationError) {
        return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: err.message, field: err.field } });
      }
      // upsertEnrollment's card-on-file check hit a gateway failure (as opposed
      // to a genuine "card not on file", which surfaces as AutopayValidationError
      // above) — never report that as a validation problem with the doctor's card.
      if (err instanceof autopayService.AutopayGatewayError) {
        return gatewayErrorResponse(reply);
      }
      throw err;
    }
  });

  fastify.delete("/admin/users/:userId/autopay", { preHandler: guard }, async (request, reply) => {
    try {
      const doctor = await loadDoctor(request.params.userId);
      await autopayService.deleteEnrollment(doctor.id);
      await auditService.logSafe({
        userId: request.user.id,
        action: "autopay.enrollment_deleted_by_admin",
        targetType: "user",
        targetId: doctor.id,
        ipAddress: request.ip,
      });
      return { data: { message: "AutoPay cancelled." } };
    } catch (err) {
      if (err instanceof DoctorNotFoundError) return notFound(reply);
      throw err;
    }
  });

  // suffix "pause" -> action "autopay.paused_by_admin"; suffix "resume" ->
  // "autopay.resumed_by_admin". Verified both read correctly as English.
  for (const [suffix, paused] of [["pause", true], ["resume", false]]) {
    fastify.post(`/admin/users/:userId/autopay/${suffix}`, { preHandler: guard }, async (request, reply) => {
      try {
        const doctor = await loadDoctor(request.params.userId);
        // M7 — pausedReason is a varchar(255) column; an unbounded body field
        // would either truncate silently at the DB or (depending on the
        // driver) error out. Reject up front with a clear message instead.
        const reason = request.body?.reason;
        if (reason != null && String(reason).length > 255) {
          return reply.code(422).send({
            error: { ...ERROR_CODES.VALIDATION_ERROR, message: "Reason must be 255 characters or fewer.", field: "reason" },
          });
        }
        const enrollment = await autopayService.setPaused(doctor.id, {
          paused,
          reason,
          actorUserId: request.user.id,
        });
        await auditService.logSafe({
          userId: request.user.id,
          action: `autopay.${suffix}d_by_admin`,
          targetType: "user",
          targetId: doctor.id,
          ipAddress: request.ip,
        });
        return { data: { enrollment } };
      } catch (err) {
        if (err instanceof DoctorNotFoundError) return notFound(reply);
        throw err;
      }
    });
  }

  // ── Card parity ──
  fastify.get("/admin/users/:userId/saved-cards", { preHandler: guard }, async (request, reply) => {
    try {
      const doctor = await loadDoctor(request.params.userId);
      try {
        return { data: { cards: await listCardsForUser(doctor) } };
      } catch (err) {
        request.log.warn({ err, userId: doctor.id }, "[AdminPayments] listCardsForUser failed");
        return gatewayErrorResponse(reply);
      }
    } catch (err) {
      if (err instanceof DoctorNotFoundError) return notFound(reply);
      throw err;
    }
  });

  /**
   * Mint a HOSTED add-card token for a doctor. The admin never sees or handles a
   * card number — the doctor's card is entered on Authorize.net's own iframe,
   * which keeps this SAQ-A.
   *
   * ensureCustomerProfile is idempotent (only creates+persists a CIM profile if
   * the doctor doesn't have one yet) but the audit entry below is written
   * unconditionally after it — an admin starting an add-card flow for a doctor
   * who already has a profile is still an auditable action.
   */
  fastify.post("/admin/users/:userId/saved-cards/hosted-token", { preHandler: guard }, async (request, reply) => {
    try {
      const doctor = await loadDoctor(request.params.userId);

      let result;
      try {
        const customerProfileId = await ensureCustomerProfile(doctor);
        result = await authorizenetService.getHostedAddCardToken({
          customerProfileId,
          iframeCommunicatorUrl: `${env.APP_URL}/IFrameCommunicator.html`,
        });
      } catch (gatewayErr) {
        request.log.warn({ err: gatewayErr, userId: doctor.id }, "[AdminPayments] hosted add-card token failed");
        return gatewayErrorResponse(reply);
      }
      if (!result?.token) {
        return gatewayErrorResponse(reply);
      }

      await auditService.logSafe({
        userId: request.user.id,
        action: "payment.card.add_started_by_admin",
        targetType: "user",
        targetId: doctor.id,
        ipAddress: request.ip,
      });
      return { data: result };
    } catch (err) {
      if (err instanceof DoctorNotFoundError) return notFound(reply);
      throw err;
    }
  });

  fastify.put("/admin/users/:userId/saved-cards/:profileId/default", { preHandler: guard }, async (request, reply) => {
    try {
      const doctor = await loadDoctor(request.params.userId);
      const profileId = String(request.params.profileId);

      let cards;
      try {
        cards = await listCardsForUser(doctor);
      } catch (err) {
        request.log.warn({ err, userId: doctor.id }, "[AdminPayments] listCardsForUser failed");
        return gatewayErrorResponse(reply);
      }
      if (!cards.some((c) => String(c.paymentProfileId) === profileId)) {
        return reply.code(404).send({ error: { ...ERROR_CODES.NOT_FOUND, message: "Card not found." } });
      }
      await db.update(users).set({ defaultPaymentProfileId: profileId, updatedAt: new Date() }).where(eq(users.id, doctor.id));
      await auditService.logSafe({
        userId: request.user.id,
        action: "payment.card.set_default_by_admin",
        targetType: "user",
        targetId: doctor.id,
        metadata: { profileId },
        ipAddress: request.ip,
      });
      return { data: { message: "Default card updated." } };
    } catch (err) {
      if (err instanceof DoctorNotFoundError) return notFound(reply);
      throw err;
    }
  });

  fastify.delete("/admin/users/:userId/saved-cards/:profileId", { preHandler: guard }, async (request, reply) => {
    try {
      const doctor = await loadDoctor(request.params.userId);
      const profileId = String(request.params.profileId);

      if (!doctor.authorizeNetCustomerProfileId) {
        return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
      }

      // Deleting the card an enrollment points at would make every future cycle
      // fail silently. Block it and make the admin change the card first.
      const enrollment = await autopayService.getEnrollment(doctor.id);
      if (enrollment?.enabled && String(enrollment.paymentProfileId) === profileId) {
        return reply.code(409).send({
          error: {
            ...ERROR_CODES.VALIDATION_ERROR,
            message: "This card is used by an active AutoPay enrollment. Change the AutoPay card or cancel AutoPay first.",
          },
        });
      }

      try {
        await authorizenetService.deletePaymentProfile({
          customerProfileId: doctor.authorizeNetCustomerProfileId,
          paymentProfileId: profileId,
        });
      } catch (err) {
        request.log.warn({ err, userId: doctor.id }, "[AdminPayments] deletePaymentProfile failed");
        return gatewayErrorResponse(reply);
      }
      if (String(doctor.defaultPaymentProfileId) === profileId) {
        await db.update(users).set({ defaultPaymentProfileId: null, updatedAt: new Date() }).where(eq(users.id, doctor.id));
      }
      await auditService.logSafe({
        userId: request.user.id,
        action: "payment.card.delete_by_admin",
        targetType: "user",
        targetId: doctor.id,
        metadata: { profileId },
        ipAddress: request.ip,
      });
      return { data: { message: "Card removed." } };
    } catch (err) {
      if (err instanceof DoctorNotFoundError) return notFound(reply);
      throw err;
    }
  });

  // Admin-parity charge: charge a doctor's saved card on their behalf,
  // allocated across invoices. Mirrors POST /payments/charge-saved
  // (payment.routes.js) exactly — same idempotency, per-invoice locking, and
  // allocation-cap enforcement — but scoped to the target doctor rather than
  // the caller, and audited as an admin action in addition to the standard
  // "payment.charge" entry recordPaymentAndAllocations already writes.
  fastify.post("/admin/users/:userId/payments/charge-saved", {
    ...ADMIN_CHARGE_RATE_LIMIT,
    preHandler: [...guard, validate(chargeSavedSchema)],
  }, async (request, reply) => {
    try {
      const doctor = await loadDoctor(request.params.userId);
      // I8 — never charge a doctor whose registration isn't approved. Same
      // 404 treatment as a missing/non-doctor target — don't confirm the id
      // belongs to a real, pending account via a different error shape.
      if (doctor.approvalStatus !== "approved") return notFound(reply);
      const { paymentProfileId, amount, allocations } = request.body;
      const customerProfileId = doctor.authorizeNetCustomerProfileId;

      const idempotencyKey = request.headers["idempotency-key"] || null;
      if (!idempotencyKey) {
        return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "An Idempotency-Key header is required." } });
      }
      if (!customerProfileId) {
        return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "No saved-card profile on file for this doctor." } });
      }
      if (!doctor.seazonaClientId) {
        return reply.code(400).send({ error: ERROR_CODES.SEAZONA_CLIENT_NOT_LINKED });
      }

      // Ownership (no cap) runs outside the idempotency replay path — every
      // request, including one that replays a cached success, must first prove
      // the submitted invoices belong to this doctor.
      const own = await verifyAllocations(allocations, doctor);
      if (own) return sendAllocationError(reply, own);

      const outcome = await withIdempotency(
        redis,
        // Scoped by the target doctor (the payer), not the acting admin — two
        // different admins retrying the same conceptual charge for the same
        // doctor must not double-charge.
        `charge-saved-admin:${doctor.id}:${idempotencyKey}`,
        async () =>
          withInvoiceLocks(
            redis,
            allocations.map((a) => a.invoiceId),
            async () => {
              const capErr = await verifyAllocations(allocations, doctor, { enforceCap: true });
              if (capErr) throw Object.assign(new Error("allocation_error"), { allocationError: capErr });

              const result = await authorizenetService.chargeCustomerProfile({
                customerProfileId,
                paymentProfileId,
                amount,
                invoiceNumber: allocations[0]?.invoiceNumber || allocations[0]?.invoiceId || undefined,
              });
              const { seazonaPaymentId, ledgerWriteFailed } = await recordPaymentAndAllocations({
                user: doctor,
                amount,
                transactionId: result.transactionId,
                allocations,
                source: "admin_card",
              });
              return { ...result, seazonaPaymentId, ...(ledgerWriteFailed ? { ledgerWriteFailed: true } : {}) };
            },
            { log: request.log }
          ),
        { log: request.log }
      );

      await auditService.logSafe({
        userId: request.user.id,
        action: "payment.charge_by_admin",
        targetType: "user",
        targetId: doctor.id,
        metadata: {
          amount,
          transactionId: outcome.result.transactionId,
          invoices: allocations.map((a) => a.invoiceNumber || a.invoiceId),
          seazonaPaymentId: outcome.result.seazonaPaymentId || null,
        },
        ipAddress: request.ip,
      });

      return { data: outcome.result };
    } catch (err) {
      if (err instanceof DoctorNotFoundError) return notFound(reply);
      if (err?.allocationError) return sendAllocationError(reply, err.allocationError);
      if (err instanceof InvoiceLockedError) return sendInvoiceLockedError(reply);
      if (err instanceof ChargeInProgressError) {
        return reply.code(409).send({ error: ERROR_CODES.CHARGE_IN_PROGRESS });
      }
      request.log.warn({ userId: request.params.userId, err: String(err?.message || err) }, "admin charge-saved failed");
      return chargeErrorReply(reply, err);
    }
  });

  // ── Jobs ──
  fastify.get("/admin/jobs", { preHandler: guard }, async () => ({
    data: { jobs: listJobs(), liveRun: env.AUTOPAY_LIVE_RUN },
  }));

  fastify.get("/admin/jobs/runs", { preHandler: guard }, async (request) => {
    // M7 — clamp BOTH ends: a non-numeric/absent limit still defaults to 50,
    // but a negative or zero value (e.g. `?limit=-5`) must not reach Postgres
    // as a negative LIMIT.
    const requested = Number(request.query?.limit);
    const limit = Math.min(Math.max(Number.isFinite(requested) && requested > 0 ? requested : 50, 1), 200);
    const rows = await db.select().from(jobRuns).orderBy(desc(jobRuns.startedAt)).limit(limit);
    return { data: { runs: rows } };
  });

  fastify.post("/admin/jobs/:name/run", { preHandler: guard }, async (request, reply) => {
    // Dry run unless the admin explicitly asks for a live run — and even then
    // AUTOPAY_LIVE_RUN must be true for the job itself to charge.
    const dryRun = request.body?.dryRun !== false;
    try {
      const result = await runJob(String(request.params.name), {
        dryRun,
        trigger: "manual",
        actorUserId: request.user.id,
        log: request.log,
      });
      await auditService.logSafe({
        userId: request.user.id,
        action: "job.run_triggered",
        targetType: "job",
        targetId: String(request.params.name),
        metadata: { dryRun, runId: result.runId, status: result.status },
        ipAddress: request.ip,
      });
      return { data: result };
    } catch (err) {
      if (err instanceof JobLockedError) {
        return reply.code(409).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: err.message } });
      }
      // M2 — mirror jobs/triggers/http.js: 404 ONLY for an unknown job name.
      // Anything else used to be flattened into the same 404 with the raw
      // err.message echoed back — a genuine unexpected failure (runJob only
      // throws for these two cases, but a future change could add more)
      // deserves a logged 500, not a misleading "not found" with internals
      // in the body.
      if (err.message?.startsWith("Unknown job")) {
        return reply.code(404).send({ error: { ...ERROR_CODES.NOT_FOUND, message: err.message } });
      }
      request.log.error({ err, job: request.params.name }, "unexpected error running job trigger");
      return reply.code(500).send({ error: ERROR_CODES.INTERNAL_ERROR });
    }
  });
}
