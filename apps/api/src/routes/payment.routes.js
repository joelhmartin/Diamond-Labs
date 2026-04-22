import { authenticate } from "../middleware/authenticate.js";
import { requireApprovedDoctor } from "../middleware/require-role.js";
import * as authorizenetService from "../services/authorizenet.service.js";
import * as seazonaService from "../services/seazona.service.js";
import { db } from "../config/database.js";
import { users } from "../db/schema/index.js";
import { eq } from "drizzle-orm";
import { ERROR_CODES } from "@my-app/shared";

export default async function paymentRoutes(fastify) {
  // Charge with an Accept.js nonce (one-time card payment)
  fastify.post("/payments/charge", {
    preHandler: [authenticate, requireApprovedDoctor],
  }, async (request, reply) => {
    const { opaqueData, amount, invoiceIds, description } = request.body;

    if (!opaqueData?.dataDescriptor || !opaqueData?.dataValue || !amount) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "opaqueData and amount are required." } });
    }

    // Charge via Authorize.net
    const result = await authorizenetService.chargeWithNonce({
      amount,
      opaqueData,
      description: description || "Diamond Labs Invoice Payment",
      invoiceNumber: invoiceIds?.[0] || undefined,
    });

    // Record payment in Seazona for each invoice
    if (request.user.seazonaClientId && invoiceIds?.length) {
      for (const invoiceId of invoiceIds) {
        await seazonaService.createPayment({
          clientId: request.user.seazonaClientId,
          accountNumber: request.user.seazonaAccountNumber,
          referenceNumber: result.transactionId,
          notes: `Authorize.net txn ${result.transactionId}`,
          amount: invoiceIds.length === 1 ? amount : undefined,
        });
      }
    }

    return { data: result };
  });

  // List saved cards
  fastify.get("/payments/saved-cards", {
    preHandler: [authenticate, requireApprovedDoctor],
  }, async (request) => {
    const cards = await authorizenetService.listPaymentProfiles(
      request.user.authorizeNetCustomerProfileId
    );
    return { data: cards };
  });

  // Add a saved card via Accept.js nonce
  fastify.post("/payments/saved-cards", {
    preHandler: [authenticate, requireApprovedDoctor],
  }, async (request, reply) => {
    const { opaqueData } = request.body;

    if (!opaqueData?.dataDescriptor || !opaqueData?.dataValue) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "opaqueData is required." } });
    }

    let customerProfileId = request.user.authorizeNetCustomerProfileId;

    // Create CIM profile if user doesn't have one yet
    if (!customerProfileId) {
      customerProfileId = await authorizenetService.createCustomerProfile({
        email: request.user.email,
        description: `Doctor: ${request.user.name}`,
      });

      await db
        .update(users)
        .set({ authorizeNetCustomerProfileId: customerProfileId, updatedAt: new Date() })
        .where(eq(users.id, request.user.id));
    }

    const paymentProfileId = await authorizenetService.addPaymentProfileFromNonce({
      customerProfileId,
      opaqueData,
    });

    return { data: { paymentProfileId } };
  });

  // Delete a saved card
  fastify.delete("/payments/saved-cards/:profileId", {
    preHandler: [authenticate, requireApprovedDoctor],
  }, async (request, reply) => {
    const customerProfileId = request.user.authorizeNetCustomerProfileId;
    if (!customerProfileId) {
      return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    }

    await authorizenetService.deletePaymentProfile({
      customerProfileId,
      paymentProfileId: request.params.profileId,
    });

    return { data: { message: "Card removed." } };
  });

  // Charge a saved card
  fastify.post("/payments/charge-saved", {
    preHandler: [authenticate, requireApprovedDoctor],
  }, async (request, reply) => {
    const { paymentProfileId, amount, invoiceIds } = request.body;
    const customerProfileId = request.user.authorizeNetCustomerProfileId;

    if (!customerProfileId || !paymentProfileId || !amount) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "paymentProfileId and amount are required." } });
    }

    const result = await authorizenetService.chargeCustomerProfile({
      customerProfileId,
      paymentProfileId,
      amount,
      invoiceNumber: invoiceIds?.[0] || undefined,
    });

    // Record in Seazona
    if (request.user.seazonaClientId && invoiceIds?.length) {
      for (const invoiceId of invoiceIds) {
        await seazonaService.createPayment({
          clientId: request.user.seazonaClientId,
          accountNumber: request.user.seazonaAccountNumber,
          referenceNumber: result.transactionId,
          notes: `Authorize.net txn ${result.transactionId}`,
          amount: invoiceIds.length === 1 ? amount : undefined,
        });
      }
    }

    return { data: result };
  });
}
