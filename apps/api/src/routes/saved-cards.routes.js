import { authenticate } from "../middleware/authenticate.js";
import { requireApprovedDoctor } from "../middleware/require-role.js";
import * as authorizenetService from "../services/authorizenet.service.js";
import { ensureCustomerProfile } from "../services/card.service.js";
import { isCardUsedByAutopay, CARD_IN_USE_BY_AUTOPAY_MESSAGE } from "../services/autopay.service.js";
import * as auditService from "../services/audit.service.js";
import { db } from "../config/database.js";
import { users } from "../db/schema/index.js";
import { eq, and } from "drizzle-orm";
import { ERROR_CODES } from "@my-app/shared";

export default async function savedCardRoutes(fastify) {
  // List saved cards, flagging the doctor's default (if still present).
  fastify.get("/payments/saved-cards", {
    preHandler: [authenticate, requireApprovedDoctor],
  }, async (request) => {
    const cards = await authorizenetService.listPaymentProfiles(
      request.user.authorizeNetCustomerProfileId
    );
    const defaultId = request.user.defaultPaymentProfileId;
    return {
      data: cards.map((c) => ({ ...c, isDefault: c.paymentProfileId === defaultId })),
    };
  });

  // Mark a saved card as the doctor's default (pre-selected when paying). The
  // profile must belong to this doctor's CIM profile.
  //
  // Profiles live at the gateway (no local FK to enforce), so there's an
  // inherent TOCTOU: a card deleted right after this ownership check could be
  // written here as the default. That's harmless by design — the column is
  // advisory UI state and the read path is self-healing: GET /payments/saved-cards
  // flags `isDefault` only for a profile that still exists in the LIVE gateway
  // list, and the pay modal falls back to the first card when nothing is flagged.
  // So a dangling default never resolves to (or mischarges) a real card.
  fastify.put("/payments/saved-cards/:profileId/default", {
    preHandler: [authenticate, requireApprovedDoctor],
  }, async (request, reply) => {
    const { profileId } = request.params;
    const customerProfileId = request.user.authorizeNetCustomerProfileId;
    if (!customerProfileId) {
      return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    }

    const profiles = await authorizenetService.listPaymentProfiles(customerProfileId);
    if (!profiles.some((p) => p.paymentProfileId === profileId)) {
      return reply.code(404).send({
        error: { ...ERROR_CODES.NOT_FOUND, message: "Payment profile not found or does not belong to your account." },
      });
    }

    await db
      .update(users)
      .set({ defaultPaymentProfileId: profileId, updatedAt: new Date() })
      .where(eq(users.id, request.user.id));

    await auditService.logSafe({
      userId: request.user.id,
      action: "payment.card.set_default",
      targetType: "payment_profile",
      targetId: profileId,
      ipAddress: request.ip,
    });

    return { data: { defaultPaymentProfileId: profileId } };
  });

  // NOTE: the Accept.js-nonce add-card path (POST /payments/saved-cards) was
  // removed (L3) — adding a card goes through the SAQ-A hosted flow below
  // (/payments/saved-cards/hosted-token), so card data never touches our DOM.

  // Get a hosted add-card token (SAQ A). The iframe is pointed at addCardUrl;
  // the token is submitted as a form-POST body to authenticate the hosted session —
  // card data is entered entirely on Authorize.net's domain. On success, Authorize.net
  // stores the new payment profile under the doctor's CIM profile (created lazily here
  // if needed). The new customerPaymentProfileId lives at the gateway and is retrieved
  // live via GET /payments/saved-cards — no local table needed.
  fastify.post("/payments/saved-cards/hosted-token", {
    preHandler: [authenticate, requireApprovedDoctor],
  }, async (request, reply) => {
    const { iframeCommunicatorUrl } = request.body || {};

    if (iframeCommunicatorUrl && !/^https?:\/\//.test(iframeCommunicatorUrl)) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "iframeCommunicatorUrl must be an http(s) URL." } });
    }

    const customerProfileId = await ensureCustomerProfile(request.user);

    const result = await authorizenetService.getHostedAddCardToken({ customerProfileId, iframeCommunicatorUrl });

    if (!result?.token) {
      return reply.code(502).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "Could not get an add-card form token." } });
    }

    return { data: { token: result.token, addCardUrl: result.addCardUrl } };
  });

  // Update a saved card (e.g., renew expiration date). Looks up the payment
  // profile to confirm ownership (gateway-scoped to this doctor's customerProfileId)
  // and to retrieve the masked cardNumber required for the update request.
  fastify.put("/payments/saved-cards/:profileId", {
    preHandler: [authenticate, requireApprovedDoctor],
  }, async (request, reply) => {
    const { expirationDate, billTo } = request.body || {};
    const { profileId } = request.params;

    if (!expirationDate || !/^\d{4}-\d{2}$/.test(expirationDate)) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "expirationDate is required (format: YYYY-MM)." } });
    }
    if (billTo !== undefined && (billTo === null || typeof billTo !== "object" || Array.isArray(billTo))) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "billTo must be a plain object." } });
    }
    const BILL_TO_ALLOWED_KEYS = ["firstName", "lastName", "company", "address", "city", "state", "zip", "country", "phoneNumber"];
    const sanitizedBillTo = billTo
      ? Object.fromEntries(Object.entries(billTo).filter(([k]) => BILL_TO_ALLOWED_KEYS.includes(k)))
      : undefined;

    const customerProfileId = request.user.authorizeNetCustomerProfileId;
    if (!customerProfileId) {
      return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    }

    const profiles = await authorizenetService.listPaymentProfiles(customerProfileId);
    const profile = profiles.find((p) => p.paymentProfileId === profileId);
    if (!profile) {
      return reply.code(404).send({ error: { ...ERROR_CODES.NOT_FOUND, message: "Payment profile not found or does not belong to your account." } });
    }

    await authorizenetService.updateCustomerPaymentProfile({
      customerProfileId,
      paymentProfileId: profileId,
      cardNumber: profile.cardNumber,
      expirationDate,
      billTo: sanitizedBillTo,
    });

    return { data: { paymentProfileId: profileId, expirationDate } };
  });

  // Delete a saved card
  fastify.delete("/payments/saved-cards/:profileId", {
    preHandler: [authenticate, requireApprovedDoctor],
  }, async (request, reply) => {
    const customerProfileId = request.user.authorizeNetCustomerProfileId;
    if (!customerProfileId) {
      return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    }

    // Same guard as the admin card-delete route: the card an enabled AutoPay
    // enrollment charges can't be removed out from under it.
    if (await isCardUsedByAutopay(request.user.id, request.params.profileId)) {
      return reply.code(409).send({
        error: { ...ERROR_CODES.VALIDATION_ERROR, message: CARD_IN_USE_BY_AUTOPAY_MESSAGE },
      });
    }

    await authorizenetService.deletePaymentProfile({
      customerProfileId,
      paymentProfileId: request.params.profileId,
    });

    // Atomically clear the preference if THIS card is the current default.
    // Conditioning the WHERE on the live column value (not the auth-time
    // `request.user` snapshot) avoids a race with a concurrent "set default"
    // from another tab — a no-op when it isn't the default.
    await db
      .update(users)
      .set({ defaultPaymentProfileId: null, updatedAt: new Date() })
      .where(
        and(
          eq(users.id, request.user.id),
          eq(users.defaultPaymentProfileId, request.params.profileId)
        )
      );

    await auditService.logSafe({
      userId: request.user.id,
      action: "payment.card.delete",
      targetType: "payment_profile",
      targetId: request.params.profileId,
      ipAddress: request.ip,
    });

    return { data: { message: "Card removed." } };
  });
}
