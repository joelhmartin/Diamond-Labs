import { authenticate } from "../middleware/authenticate.js";
import { requireApprovedDoctor } from "../middleware/require-role.js";
import * as authorizenetService from "../services/authorizenet.service.js";
import * as seazonaService from "../services/seazona.service.js";
import { db } from "../config/database.js";
import { users, invoicePayments } from "../db/schema/index.js";
import { eq } from "drizzle-orm";
import { createId } from "../lib/id.js";
import { ERROR_CODES } from "@my-app/shared";

/**
 * Validate a payment allocation: a list of {invoiceId, invoiceNumber?, amount}
 * slices whose amounts must sum to the total charge (within a cent).
 */
function validateAllocations(allocations, amount) {
  if (!Array.isArray(allocations) || allocations.length === 0) {
    return "allocations[] is required.";
  }
  for (const a of allocations) {
    if (!a.invoiceId) return "Each allocation needs an invoiceId.";
    if (!(Number(a.amount) > 0)) return "Each allocation amount must be greater than zero.";
  }
  const sum = allocations.reduce((s, a) => s + Number(a.amount), 0);
  if (Math.abs(sum - Number(amount)) > 0.01) {
    return `Allocations ($${sum.toFixed(2)}) must sum to the charge amount ($${Number(amount).toFixed(2)}).`;
  }
  return null;
}

function buildAllocationNotes(allocations, transactionId) {
  const parts = allocations.map(
    (a) => `${a.invoiceNumber || a.invoiceId} $${Number(a.amount).toFixed(2)}`
  );
  return `DOL portal txn ${transactionId} — ${parts.join("; ")}`.slice(0, 500);
}

/**
 * After a successful charge: record ONE account-level payment in Seazona (their
 * payment API has no invoice-level granularity) with notes describing the split,
 * then write one local invoice_payments row per allocated invoice.
 */
async function recordPaymentAndAllocations({ user, amount, transactionId, allocations }) {
  let seazonaPaymentId = null;

  if (user.seazonaClientId) {
    const res = await seazonaService.createPayment({
      clientId: user.seazonaClientId,
      accountNumber: user.seazonaAccountNumber,
      referenceNumber: transactionId,
      notes: buildAllocationNotes(allocations, transactionId),
      amount,
    });
    seazonaPaymentId = res?.paymentId || null;
  }

  await db.insert(invoicePayments).values(
    allocations.map((a) => ({
      id: createId(),
      userId: user.id,
      seazonaClientId: user.seazonaClientId || null,
      seazonaInvoiceId: String(a.invoiceId),
      invoiceNumber: a.invoiceNumber ? String(a.invoiceNumber) : null,
      appliedAmount: Number(a.amount).toFixed(2),
      transactionId,
      seazonaPaymentId,
    }))
  );

  return seazonaPaymentId;
}

export default async function paymentRoutes(fastify) {
  // ───────────────────────────────────────────────────────────────
  // PUBLIC CHECKOUT — unauthenticated card charge for catalog orders.
  // Guest shoppers pay for purchasable SKUs (accessories, supplies, samples).
  // Required: opaqueData (Accept.js nonce), amount, items[], email, shipping{}.
  // Intentionally does NOT store a CIM profile (guest checkout).
  // ───────────────────────────────────────────────────────────────
  fastify.post("/payments/checkout", async (request, reply) => {
    const { opaqueData, amount, items, email, shipping, phone } = request.body || {};

    if (!opaqueData?.dataDescriptor || !opaqueData?.dataValue) {
      return reply.code(422).send({
        error: { ...ERROR_CODES.VALIDATION_ERROR, message: "Payment nonce (opaqueData) is required." },
      });
    }
    if (!amount || Number(amount) <= 0) {
      return reply.code(422).send({
        error: { ...ERROR_CODES.VALIDATION_ERROR, message: "Amount must be greater than zero." },
      });
    }
    if (!email || !email.includes("@")) {
      return reply.code(422).send({
        error: { ...ERROR_CODES.VALIDATION_ERROR, message: "Valid email is required." },
      });
    }
    if (!shipping?.name || !shipping?.address1 || !shipping?.city || !shipping?.state || !shipping?.postalCode) {
      return reply.code(422).send({
        error: { ...ERROR_CODES.VALIDATION_ERROR, message: "Complete shipping address is required." },
      });
    }

    const invoiceNumber = `DOL-${Date.now().toString().slice(-8)}`;
    const description = `Diamond Orthotic Catalog — ${items?.length || 0} item(s)`;

    const result = await authorizenetService.chargeWithNonce({
      amount: Number(amount),
      opaqueData,
      description,
      invoiceNumber,
      // TODO: pass customer + shipping to Authorize.net once service signature is extended
    });

    fastify.log.info(
      { invoiceNumber, transactionId: result.transactionId, email, itemCount: items?.length },
      "public catalog checkout succeeded"
    );

    // TODO: create a Seazona invoice + payment record; send order confirmation email.

    return {
      data: {
        transactionId: result.transactionId,
        invoiceNumber,
        amount: Number(amount),
        email,
      },
    };
  });

  // Charge with an Accept.js nonce (one-time card payment), allocated across invoices
  fastify.post("/payments/charge", {
    preHandler: [authenticate, requireApprovedDoctor],
  }, async (request, reply) => {
    const { opaqueData, amount, allocations, description } = request.body;

    if (!opaqueData?.dataDescriptor || !opaqueData?.dataValue || !amount) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "opaqueData and amount are required." } });
    }
    const allocErr = validateAllocations(allocations, amount);
    if (allocErr) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: allocErr } });
    }

    const result = await authorizenetService.chargeWithNonce({
      amount,
      opaqueData,
      description: description || "Diamond Labs Invoice Payment",
      invoiceNumber: allocations[0]?.invoiceNumber || allocations[0]?.invoiceId || undefined,
    });

    const seazonaPaymentId = await recordPaymentAndAllocations({
      user: request.user,
      amount,
      transactionId: result.transactionId,
      allocations,
    });

    return { data: { ...result, seazonaPaymentId } };
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

  // Charge a saved card, allocated across invoices
  fastify.post("/payments/charge-saved", {
    preHandler: [authenticate, requireApprovedDoctor],
  }, async (request, reply) => {
    const { paymentProfileId, amount, allocations } = request.body;
    const customerProfileId = request.user.authorizeNetCustomerProfileId;

    if (!customerProfileId || !paymentProfileId || !amount) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "paymentProfileId and amount are required." } });
    }
    const allocErr = validateAllocations(allocations, amount);
    if (allocErr) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: allocErr } });
    }

    const result = await authorizenetService.chargeCustomerProfile({
      customerProfileId,
      paymentProfileId,
      amount,
      invoiceNumber: allocations[0]?.invoiceNumber || allocations[0]?.invoiceId || undefined,
    });

    const seazonaPaymentId = await recordPaymentAndAllocations({
      user: request.user,
      amount,
      transactionId: result.transactionId,
      allocations,
    });

    return { data: { ...result, seazonaPaymentId } };
  });

  // ───────────────────────────────────────────────────────────────
  // TEST — Accept Hosted (SAQ A) end-to-end check. Card data is entered on
  // Authorize.net's hosted iframe, never our DOM. These endpoints intentionally
  // do NOT write to Seazona or the invoice_payments ledger — they only exercise
  // the Authorize.net pipeline. `mode` defaults to sandbox; production is allowed
  // for a small real-charge smoke test (void it in the Authorize.net dashboard).
  // ───────────────────────────────────────────────────────────────
  fastify.post("/payments/test/hosted-token", {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { amount, mode = "sandbox", iframeCommunicatorUrl } = request.body || {};

    if (!(Number(amount) > 0) || Number(amount) > 100000) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "amount must be between 0 and 100000." } });
    }
    if (mode !== "sandbox" && mode !== "production") {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "mode must be 'sandbox' or 'production'." } });
    }
    if (iframeCommunicatorUrl && !/^https?:\/\//.test(iframeCommunicatorUrl)) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "iframeCommunicatorUrl must be an http(s) URL." } });
    }

    const refId = `TEST-${Date.now().toString().slice(-10)}`;
    const result = await authorizenetService.getHostedPaymentPageToken({
      amount: Number(amount),
      invoiceNumber: refId,
      description: "Diamond Labs test payment",
      refId,
      iframeCommunicatorUrl,
    }, mode);

    if (!result?.token) {
      return reply.code(502).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: `Could not get a ${mode} form token — check Authorize.net ${mode} credentials.` } });
    }

    return { data: { token: result.token, formUrl: result.formUrl, refId, mode } };
  });

  fastify.post("/payments/test/hosted-complete", {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { transId, mode = "sandbox" } = request.body || {};

    if (!transId) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "transId is required." } });
    }
    if (mode !== "sandbox" && mode !== "production") {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "mode must be 'sandbox' or 'production'." } });
    }

    const details = await authorizenetService.getTransactionDetails(transId, mode);
    if (!details) {
      return reply.code(404).send({ error: { ...ERROR_CODES.NOT_FOUND, message: "Transaction not found." } });
    }

    return { data: details };
  });
}
