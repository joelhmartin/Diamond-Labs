import { authenticate } from "../middleware/authenticate.js";
import { requireApprovedDoctor } from "../middleware/require-role.js";
import { validate } from "../middleware/validate.js";
import * as authorizenetService from "../services/authorizenet.service.js";
import { ensureCustomerProfile } from "../services/card.service.js";
import { db } from "../config/database.js";
import { redis } from "../config/redis.js";
import { invoicePayments } from "../db/schema/index.js";
import { eq } from "drizzle-orm";
import { createId } from "../lib/id.js";
import { formatCents, sumCents, toCents, toDecimalString } from "../lib/money.js";
import { ERROR_CODES, chargeSavedSchema, hostedTokenSchema, hostedCompleteSchema } from "@my-app/shared";
import {
  withIdempotency,
  ChargeInProgressError,
  withInvoiceLocks,
  InvoiceLockedError,
  safeParse,
} from "../lib/payment-helpers.js";
import { verifyAllocations, recordPaymentAndAllocations } from "../services/payment-recording.service.js";
import { chargeSavedCardAndRecord } from "../services/card-charge.service.js";
import { CHARGE_RATE_LIMIT, chargeErrorReply, sendInvoiceLockedError, sendAllocationError } from "./payment-replies.js";

// Hosted-payment binding record TTL (C2): a doctor has ~30 min to complete a
// hosted charge before the issued token's server-side binding expires.
const HOSTED_BINDING_TTL = 30 * 60;

// A hosted payment Authorize.net captured but we refused to record (cap or bound
// amount). The card was charged and nothing is on the ledger: alertable, ids and
// amounts only, never free text.
function logCapturedNotRecorded({ transId, userId, cents, allocations }) {
  console.error(
    "[PAYMENT][CAPTURED_NOT_RECORDED] hosted payment captured but refused by the cap or bound-amount check — manual reconcile required " +
      JSON.stringify({ transactionId: String(transId), userId, amountCents: cents, invoiceIds: allocations.map((a) => String(a.invoiceId)) })
  );
}

// Requires an Idempotency-Key header (H1/L5): the frontend mints one per submit.
async function chargeSaved(request, reply) {
  const { paymentProfileId, amountCents, allocations } = request.body;
  const customerProfileId = request.user.authorizeNetCustomerProfileId;

  const idempotencyKey = request.headers["idempotency-key"] || null;
  if (!idempotencyKey) {
    return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "An Idempotency-Key header is required." } });
  }
  if (!customerProfileId) {
    return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "No saved-card profile on file for this account." } });
  }
  // Ownership (no cap) runs OUTSIDE the idempotency replay path: every request,
  // a replay included, must first prove the invoices are the caller's, so a
  // guessed key can't replay another doctor's result.
  const own = await verifyAllocations(allocations, request.user);
  if (own) return sendAllocationError(reply, own);

  let outcome;
  try {
    outcome = await withIdempotency(
      redis,
      `charge-saved:${request.user.id}:${idempotencyKey}`,
      async () =>
        // D1: two different keys hitting one invoice must not both pass the cap.
        withInvoiceLocks(
          redis,
          allocations.map((a) => a.invoiceId),
          () =>
            chargeSavedCardAndRecord({
              payer: request.user,
              customerProfileId,
              paymentProfileId,
              amountCents,
              allocations,
              source: "doctor_card",
            }),
          { log: request.log }
        ),
      { log: request.log }
    );
  } catch (err) {
    if (err?.allocationError) return sendAllocationError(reply, err.allocationError);
    if (err instanceof InvoiceLockedError) return sendInvoiceLockedError(reply);
    if (err instanceof ChargeInProgressError) return reply.code(409).send({ error: ERROR_CODES.CHARGE_IN_PROGRESS });
    request.log.warn({ userId: request.user.id, err: String(err?.message || err) }, "charge-saved failed");
    return chargeErrorReply(reply, err);
  }
  return { data: outcome.result };
}

// A new card on Authorize.net's hosted page. The amount is the allocation
// sum, baked into the token server-side; the mode follows AUTHORIZE_NET_ENV.
async function hostedToken(request, reply) {
  const { allocations, iframeCommunicatorUrl, saveCard } = request.body || {};
  if (iframeCommunicatorUrl && !/^https?:\/\//.test(iframeCommunicatorUrl)) {
    return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "iframeCommunicatorUrl must be an http(s) URL." } });
  }
  const v = await verifyAllocations(allocations, request.user, { enforceCap: true });
  if (v) return sendAllocationError(reply, v);
  const amountCents = sumCents(allocations.map((a) => a.amountCents));

  // Save-card: create the CIM profile lazily so the gateway has a customer
  // to attach the new card to.
  const customerProfileId = saveCard ? await ensureCustomerProfile(request.user) : undefined;

  // C2: bind the transaction to THIS doctor and THIS token. hosted-complete
  // records only a transaction whose order.invoiceNumber matches a binding
  // owned by the caller, and records the allocations bound here.
  const refId = `H${createId().slice(0, 14)}`;
  await redis.set(
    `rxpay:hosted:${refId}`,
    JSON.stringify({ userId: request.user.id, allocations, amountCents }),
    "EX",
    HOSTED_BINDING_TTL
  );

  const result = await authorizenetService.getHostedPaymentPageToken({
    amount: toDecimalString(amountCents),
    // order.invoiceNumber round-trips through getTransactionDetails; the refId does not reliably.
    invoiceNumber: refId,
    description: `Diamond Labs — invoice(s): ${allocations.map((a) => a.invoiceNumber).join(", ")}`.slice(0, 255),
    refId,
    iframeCommunicatorUrl,
    customerProfileId,
    allowSaveCard: Boolean(saveCard),
  });
  if (!result?.token) {
    await redis.del(`rxpay:hosted:${refId}`).catch(() => {});
    return reply.code(502).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "Could not get a payment form token." } });
  }
  return { data: { token: result.token, formUrl: result.formUrl, refId, amountCents } };
}

// Finalize a hosted payment: verify what Authorize.net captured, then record
// the ledger. Idempotent on transId. A saved card lives at the gateway under
// the doctor's CIM profile; nothing to store here.
async function hostedComplete(request, reply) {
  const { transId, refId, allocations } = request.body;

  const existing = await db.select().from(invoicePayments).where(eq(invoicePayments.transactionId, String(transId)));
  if (existing.length) return { data: { transId, alreadyRecorded: true, rows: existing.length } };

  // C2 (a): the binding must exist and be the caller's.
  const binding = safeParse(await redis.get(`rxpay:hosted:${refId}`));
  if (!binding || String(binding.userId) !== String(request.user.id)) {
    return reply.code(403).send({ error: { ...ERROR_CODES.FORBIDDEN, message: "Payment session not found or does not belong to your account." } });
  }
  // Record what the token was issued for, never caller-supplied allocations.
  const boundAllocations = Array.isArray(binding.allocations) && binding.allocations.length ? binding.allocations : allocations;

  const details = await authorizenetService.getTransactionDetails(transId);
  if (!details) return reply.code(404).send({ error: { ...ERROR_CODES.NOT_FOUND, message: "Transaction not found." } });

  // C2 (b): the captured transaction carries our binding token.
  if (String(details.orderInvoiceNumber) !== String(refId) && String(details.refId) !== String(refId)) {
    return reply.code(403).send({ error: { ...ERROR_CODES.FORBIDDEN, message: "Transaction does not match the issued payment session." } });
  }
  // C2 (c): only an approved, captured or settled transaction is recordable.
  const SETTLED_OR_PENDING = new Set(["capturedPendingSettlement", "settledSuccessfully"]);
  if (String(details.responseCode) !== "1" || !SETTLED_OR_PENDING.has(String(details.transactionStatus))) {
    return reply.code(422).send({
      error: { ...ERROR_CODES.VALIDATION_ERROR, message: `Transaction is not in a recordable state (status: ${details.transactionStatus || "unknown"}).` },
    });
  }
  // C2 (d): captured amount = the bound allocation sum, to the cent.
  const capturedCents = toCents(details.amount);
  const boundCents = sumCents(boundAllocations.map((a) => a.amountCents));
  if (capturedCents !== boundCents) {
    logCapturedNotRecorded({ transId, userId: request.user.id, cents: capturedCents, allocations: boundAllocations });
    return reply.code(422).send({
      error: { ...ERROR_CODES.VALIDATION_ERROR, message: `Allocation total (${formatCents(boundCents)}) does not match the captured amount (${formatCents(capturedCents)}).` },
    });
  }

  // D1: lock the bound invoices across cap check → ledger write.
  let recorded;
  try {
    recorded = await withInvoiceLocks(
      redis,
      boundAllocations.map((a) => a.invoiceId),
      async () => {
        // Under the locks, so two concurrent completes of one transaction can't both record it.
        const dup = await db.select({ id: invoicePayments.id }).from(invoicePayments).where(eq(invoicePayments.transactionId, String(transId)));
        if (dup.length) return { alreadyRecorded: dup.length };
        const v = await verifyAllocations(boundAllocations, request.user, { enforceCap: true });
        if (v) return { allocationError: v };
        return {
          result: await recordPaymentAndAllocations({
            user: request.user,
            amountCents: capturedCents,
            transactionId: String(transId),
            allocations: boundAllocations,
            source: "doctor_hosted",
          }),
        };
      },
      { log: request.log }
    );
  } catch (err) {
    if (err instanceof InvoiceLockedError) return sendInvoiceLockedError(reply);
    throw err;
  }
  if (recorded.alreadyRecorded) return { data: { transId, alreadyRecorded: true, rows: recorded.alreadyRecorded } };
  if (recorded.allocationError) {
    logCapturedNotRecorded({ transId, userId: request.user.id, cents: capturedCents, allocations: boundAllocations });
    return sendAllocationError(reply, recorded.allocationError);
  }

  // One-time use.
  await redis.del(`rxpay:hosted:${refId}`).catch(() => {});
  return {
    data: {
      transId,
      amountCents: capturedCents,
      status: details.status,
      recorded: true,
      ...(recorded.result.ledgerWriteFailed ? { ledgerWriteFailed: true } : {}),
    },
  };
}

/**
 * A doctor pays their invoices: with a saved card (charge-saved), or a new card
 * on Authorize.net's hosted page (hosted-token → hosted-complete, SAQ A).
 * Allocations are [{ invoiceId, amountCents }] against OUR invoices. Every
 * request first proves the caller may pay them (verifyAllocations →
 * canActOnInvoice); the balance cap is re-checked inside the per-invoice locks,
 * right before money moves or is recorded. Dollars appear only on the
 * Authorize.net wire (toDecimalString out, toCents back). The three handlers
 * are module functions (the function-length rule); registration is at the end.
 */
export default async function invoicePaymentRoutes(fastify) {
  fastify.post("/payments/charge-saved", { ...CHARGE_RATE_LIMIT, preHandler: [authenticate, requireApprovedDoctor, validate(chargeSavedSchema)] }, chargeSaved);
  fastify.post("/payments/hosted-token", { ...CHARGE_RATE_LIMIT, preHandler: [authenticate, requireApprovedDoctor, validate(hostedTokenSchema)] }, hostedToken);
  fastify.post("/payments/hosted-complete", { ...CHARGE_RATE_LIMIT, preHandler: [authenticate, requireApprovedDoctor, validate(hostedCompleteSchema)] }, hostedComplete);
}
