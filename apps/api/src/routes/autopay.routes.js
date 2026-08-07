import { authenticate } from "../middleware/authenticate.js";
import { requireApprovedDoctor } from "../middleware/require-role.js";
import { validate } from "../middleware/validate.js";
import { autopayEnrollSchema, ERROR_CODES } from "@my-app/shared";
import * as autopayService from "../services/autopay.service.js";
import { listCardsForUser } from "../services/card.service.js";
import * as auditService from "../services/audit.service.js";
import { db } from "../config/database.js";
import { autopayAttempts } from "../db/schema/index.js";
import { eq, desc } from "drizzle-orm";
import { env } from "../config/env.js";
import { resolveChargeDay, zonedParts } from "../lib/autopay-schedule.js";

/** Next calendar date this enrollment would charge, in lab time. */
function nextRunDate(enrollment, now = new Date()) {
  if (!enrollment?.enabled || enrollment.status !== "active") return null;
  const { year, month, day } = zonedParts(now, env.AUTOPAY_TIMEZONE);
  const thisMonth = resolveChargeDay(year, month, enrollment.dayOfMonth);
  if (day < thisMonth) return `${year}-${String(month).padStart(2, "0")}-${String(thisMonth).padStart(2, "0")}`;
  const ny = month === 12 ? year + 1 : year;
  const nm = month === 12 ? 1 : month + 1;
  const next = resolveChargeDay(ny, nm, enrollment.dayOfMonth);
  return `${ny}-${String(nm).padStart(2, "0")}-${String(next).padStart(2, "0")}`;
}

function serialize(enrollment) {
  if (!enrollment) return null;
  return {
    enabled: enrollment.enabled,
    amount: Number(enrollment.amount),
    dayOfMonth: enrollment.dayOfMonth,
    paymentProfileId: enrollment.paymentProfileId,
    status: enrollment.status,
    pausedReason: enrollment.pausedReason,
    consecutiveFailures: enrollment.consecutiveFailures,
    minAmount: autopayService.effectiveFloor(enrollment),
    lastChargedAt: enrollment.lastChargedAt,
    nextRunDate: nextRunDate(enrollment),
  };
}

/**
 * 502 helper for AutopayGatewayError — used by both GET and PUT. A gateway
 * hiccup (network error, stale customerProfileId, transient Authorize.net
 * failure) is never the doctor's fault and must not be reported as a
 * validation problem with their card.
 */
function gatewayErrorResponse(reply) {
  return reply.code(502).send({
    error: {
      ...ERROR_CODES.PAYMENT_GATEWAY_ERROR,
      message: "Could not reach the card processor. Please try again shortly.",
    },
  });
}

export default async function autopayRoutes(fastify) {
  fastify.get("/autopay", { preHandler: [authenticate, requireApprovedDoctor] }, async (request, reply) => {
    const enrollment = await autopayService.getEnrollment(request.user.id);

    // listCardsForUser hits Authorize.net and can throw on a gateway failure
    // (see card.service.js / authorizenet.service.js) — as distinct from a
    // doctor who legitimately has no cards on file (that's a `[]`, not a
    // throw). Conflating the two would render a transient outage as "you have
    // no cards on file", which wrongly tells a doctor with a good card on file
    // to go add a new one. Surface it as an explicit `cardsUnavailable` flag
    // instead of a misleading empty list, and don't claim they can/can't
    // enroll when we don't actually know.
    let cards = [];
    let cardsUnavailable = false;
    try {
      cards = await listCardsForUser(request.user);
    } catch (err) {
      request.log.warn({ err, userId: request.user.id }, "[Autopay] listCardsForUser failed");
      cardsUnavailable = true;
    }

    return {
      data: {
        enrollment: serialize(enrollment),
        cards,
        cardsUnavailable,
        minAmount: autopayService.effectiveFloor(enrollment),
        // The UI must not offer enrollment without a card, and the server
        // enforces the same rule. When card state is unknown (gateway down),
        // canEnroll is false too — we cannot vouch for a card we couldn't see.
        canEnroll: !cardsUnavailable && cards.length > 0,
      },
    };
  });

  fastify.put("/autopay", {
    preHandler: [authenticate, requireApprovedDoctor, validate(autopayEnrollSchema)],
  }, async (request, reply) => {
    try {
      const enrollment = await autopayService.upsertEnrollment({
        user: request.user,
        ...request.body,
        // A doctor can never set their own floor override. `validate()`
        // already replaced request.body with the result of parsing against
        // autopayEnrollSchema — which has no minAmountOverride field — so a
        // smuggled key can't reach here; this is stated explicitly anyway so
        // the intent doesn't depend on that stripping behavior alone.
        minAmountOverride: undefined,
        actorUserId: request.user.id,
      });
      await auditService.logSafe({
        userId: request.user.id,
        action: "autopay.enrollment_updated",
        targetType: "user",
        targetId: request.user.id,
        metadata: { amount: request.body.amount, dayOfMonth: request.body.dayOfMonth, enabled: enrollment.enabled },
        ipAddress: request.ip,
      });
      return { data: { enrollment: serialize(enrollment) } };
    } catch (err) {
      if (err instanceof autopayService.AutopayValidationError) {
        return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: err.message, field: err.field } });
      }
      // AutopayGatewayError means Authorize.net itself failed the card check
      // (network error, stale profile id, a non-"Ok" resultCode) — not that
      // the doctor's card is missing. Reporting it as a 422 would tell a
      // doctor with a perfectly good card on file to go add one during a
      // transient outage, which is worse than just failing the request.
      if (err instanceof autopayService.AutopayGatewayError) {
        return gatewayErrorResponse(reply);
      }
      throw err;
    }
  });

  fastify.delete("/autopay", { preHandler: [authenticate, requireApprovedDoctor] }, async (request) => {
    await autopayService.deleteEnrollment(request.user.id);
    await auditService.logSafe({
      userId: request.user.id,
      action: "autopay.enrollment_deleted",
      targetType: "user",
      targetId: request.user.id,
      ipAddress: request.ip,
    });
    return { data: { message: "AutoPay cancelled." } };
  });

  fastify.get("/autopay/attempts", { preHandler: [authenticate, requireApprovedDoctor] }, async (request) => {
    const rows = await db
      .select()
      .from(autopayAttempts)
      .where(eq(autopayAttempts.userId, request.user.id))
      .orderBy(desc(autopayAttempts.createdAt))
      .limit(50);
    return { data: { attempts: rows } };
  });
}
