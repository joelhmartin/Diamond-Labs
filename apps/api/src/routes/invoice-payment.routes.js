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
import { ERROR_CODES, chargeSavedSchema, hostedTokenSchema, hostedCompleteSchema } from "@my-app/shared";
import {
  withIdempotency,
  ChargeInProgressError,
  withInvoiceLocks,
  InvoiceLockedError,
  safeParse,
} from "../lib/payment-helpers.js";
import { verifyAllocations, recordPaymentAndAllocations } from "../services/payment-recording.service.js";
import { CHARGE_RATE_LIMIT, chargeErrorReply, sendInvoiceLockedError, sendAllocationError } from "./payment-replies.js";

// Hosted-payment binding record TTL (C2): a doctor has ~30 min to complete a
// hosted charge before the issued token's server-side binding expires.
const HOSTED_BINDING_TTL = 30 * 60;

export default async function invoicePaymentRoutes(fastify) {
  // Charge a saved card, allocated across invoices. Requires an Idempotency-Key
  // header (H1/L5) — the frontend mints a crypto.randomUUID() per submit.
  fastify.post("/payments/charge-saved", {
    ...CHARGE_RATE_LIMIT,
    preHandler: [authenticate, requireApprovedDoctor, validate(chargeSavedSchema)],
  }, async (request, reply) => {
    const { paymentProfileId, amount, allocations } = request.body;
    const customerProfileId = request.user.authorizeNetCustomerProfileId;

    const idempotencyKey = request.headers["idempotency-key"] || null;
    if (!idempotencyKey) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "An Idempotency-Key header is required." } });
    }
    if (!customerProfileId) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "No saved-card profile on file for this account." } });
    }
    // Same ownership guard as the hosted path — never charge a saved card
    // against an invoice that isn't this doctor's.
    if (!request.user.seazonaClientId) {
      return reply.code(400).send({ error: ERROR_CODES.SEAZONA_CLIENT_NOT_LINKED });
    }
    // Ownership (NO cap) runs OUTSIDE the idempotency replay path: every request —
    // including one that replays a cached success — must first prove the submitted
    // invoices belong to the caller. Combined with the user-scoped idempotency key
    // below, this prevents reusing/guessing another doctor's key to replay their
    // result. Only the remaining-balance CAP is deferred to first execution.
    const own = await verifyAllocations(allocations, request.user);
    if (own) return sendAllocationError(reply, own);

    let outcome;
    try {
      outcome = await withIdempotency(
        redis,
        `charge-saved:${request.user.id}:${idempotencyKey}`,
        async () =>
          // D1 — per-invoice mutex around the verify-cap → charge → record window.
          // The idempotency-key lock only serializes retries of the SAME key; two
          // DIFFERENT keys hitting the same invoice could both read paid=0, both
          // pass the cap, and both charge. Lock every allocated invoice (sorted,
          // deadlock-free) for the duration of this critical section.
          withInvoiceLocks(
            redis,
            allocations.map((a) => a.invoiceId),
            async () => {
              // C1 over-allocation cap runs INSIDE the idempotent block so a retry of
              // the same Idempotency-Key replays the cached success rather than
              // re-failing the cap on an invoice the first attempt already paid.
              const capErr = await verifyAllocations(allocations, request.user, { enforceCap: true });
              if (capErr) throw Object.assign(new Error("allocation_error"), { allocationError: capErr });

              const result = await authorizenetService.chargeCustomerProfile({
                customerProfileId,
                paymentProfileId,
                amount,
                invoiceNumber: allocations[0]?.invoiceNumber || allocations[0]?.invoiceId || undefined,
              });
              const { seazonaPaymentId, ledgerWriteFailed } = await recordPaymentAndAllocations({
                user: request.user,
                amount,
                transactionId: result.transactionId,
                allocations,
                source: "doctor_card",
              });
              return { ...result, seazonaPaymentId, ...(ledgerWriteFailed ? { ledgerWriteFailed: true } : {}) };
            },
            { log: fastify.log }
          ),
        // Migration dual-read: results cached under the pre-user-scoping key
        // (`charge-saved:<key>`, 24h TTL) still replay across this deploy so a
        // retry that spans it can't double-charge.
        { log: fastify.log, legacyKeys: [`charge-saved:${idempotencyKey}`] }
      );
    } catch (err) {
      if (err?.allocationError) return sendAllocationError(reply, err.allocationError);
      if (err instanceof InvoiceLockedError) return sendInvoiceLockedError(reply);
      if (err instanceof ChargeInProgressError) {
        return reply.code(409).send({ error: ERROR_CODES.CHARGE_IN_PROGRESS });
      }
      fastify.log.warn({ userId: request.user.id, err: String(err?.message || err) }, "charge-saved failed");
      return chargeErrorReply(reply, err);
    }

    return { data: outcome.result };
  });

  // ───────────────────────────────────────────────────────────────
  // REAL invoice payment via Accept Hosted (SAQ A). New-card path: card is
  // entered on Authorize.net's hosted iframe (never our DOM). The amount is the
  // allocation sum, baked into the token server-side. Mode resolves from
  // AUTHORIZE_NET_ENV (sandbox locally, production once deployed) — clients
  // cannot pick the mode, so a payment record always reflects a real charge.
  // ───────────────────────────────────────────────────────────────
  fastify.post("/payments/hosted-token", {
    ...CHARGE_RATE_LIMIT,
    preHandler: [authenticate, requireApprovedDoctor, validate(hostedTokenSchema)],
  }, async (request, reply) => {
    const { allocations, iframeCommunicatorUrl, saveCard } = request.body || {};

    if (!request.user.seazonaClientId) {
      return reply.code(400).send({ error: ERROR_CODES.SEAZONA_CLIENT_NOT_LINKED });
    }
    const amount = Math.round(
      (allocations.reduce((s, a) => s + Number(a.amount || 0), 0) + Number.EPSILON) * 100
    ) / 100;
    if (iframeCommunicatorUrl && !/^https?:\/\//.test(iframeCommunicatorUrl)) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "iframeCommunicatorUrl must be an http(s) URL." } });
    }

    const v = await verifyAllocations(allocations, request.user);
    if (v) return sendAllocationError(reply, v);

    // When the frontend requests save-card, lazily create the CIM profile so
    // Authorize.net has a customer to attach the saved card to. The profile ID
    // is baked into the hosted-page token; the gateway enforces ownership.
    let customerProfileId;
    if (saveCard) {
      customerProfileId = await ensureCustomerProfile(request.user);
    }

    // C2 — bind the transaction to THIS doctor + THIS issued token. A short,
    // unique refId (≤20 chars, cuid2-derived) is passed to Authorize.net AND
    // stored server-side keyed by refId. hosted-complete will only record a
    // transaction whose Authorize.net `refId` matches a stored record owned by
    // the caller. This stops a doctor from claiming another doctor's transId.
    const refId = `H${createId().slice(0, 14)}`;
    await redis.set(
      `rxpay:hosted:${refId}`,
      JSON.stringify({ userId: request.user.id, allocations, amount }),
      "EX",
      HOSTED_BINDING_TTL
    );

    const result = await authorizenetService.getHostedPaymentPageToken({
      amount,
      // Bind via order.invoiceNumber = refId. Unlike the transaction-level refId
      // (which Authorize.net does NOT reliably echo back in getTransactionDetails),
      // order.invoiceNumber DOES round-trip — so hosted-complete can match it.
      // Human-readable invoice context goes in the description.
      invoiceNumber: refId,
      description: `Diamond Labs — invoice(s): ${allocations.map((a) => a.invoiceNumber || a.invoiceId).join(", ")}`.slice(0, 255),
      refId,
      iframeCommunicatorUrl,
      customerProfileId,
      allowSaveCard: Boolean(saveCard),
    });

    if (!result?.token) {
      // Roll back the binding record so a stale refId doesn't linger.
      await redis.del(`rxpay:hosted:${refId}`).catch(() => {});
      return reply.code(502).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "Could not get a payment form token." } });
    }
    return { data: { token: result.token, formUrl: result.formUrl, refId, amount } };
  });

  // Finalize a hosted invoice payment: verify the captured amount server-side,
  // then record one Seazona payment + the local allocation ledger. Idempotent
  // on transId so a double postMessage / retry can't double-record.
  //
  // Save-card persistence note: when the doctor checked "save card" on the hosted
  // form, Authorize.net stores the new payment profile under their CIM customer
  // profile autonomously — we don't need to do anything here. The customerProfileId
  // was set on users.authorizeNetCustomerProfileId before the token was issued
  // (ensureCustomerProfile in /payments/hosted-token), and individual payment profile
  // IDs live at the gateway and are listed live via GET /payments/saved-cards.
  // No additional DB write is required; no new table is needed.
  fastify.post("/payments/hosted-complete", {
    ...CHARGE_RATE_LIMIT,
    preHandler: [authenticate, requireApprovedDoctor, validate(hostedCompleteSchema)],
  }, async (request, reply) => {
    const { transId, refId, allocations } = request.body;

    // L2 — same early guard the other doctor endpoints have.
    if (!request.user.seazonaClientId) {
      return reply.code(400).send({ error: ERROR_CODES.SEAZONA_CLIENT_NOT_LINKED });
    }

    // Global dedup — a double postMessage / retry must never double-record.
    const existing = await db
      .select()
      .from(invoicePayments)
      .where(eq(invoicePayments.transactionId, String(transId)));
    if (existing.length) {
      return { data: { transId, alreadyRecorded: true, rows: existing.length } };
    }

    // C2 (a) — a binding record must exist for this refId AND be owned by the
    // caller. This is the doctor↔transaction binding: only the doctor the token
    // was issued to can complete it.
    const bindingRaw = await redis.get(`rxpay:hosted:${refId}`);
    const binding = safeParse(bindingRaw);
    if (!binding || String(binding.userId) !== String(request.user.id)) {
      return reply.code(403).send({ error: { ...ERROR_CODES.FORBIDDEN, message: "Payment session not found or does not belong to your account." } });
    }
    // Record the allocations bound at token time — NOT the caller-supplied ones.
    // Otherwise a doctor could complete a captured charge against a different
    // (equal-amount) invoice than the one the token was issued for.
    const boundAllocations = Array.isArray(binding.allocations) && binding.allocations.length
      ? binding.allocations
      : allocations;

    // Anchor of trust: whatever we record must equal what Authorize.net captured.
    const details = await authorizenetService.getTransactionDetails(transId);
    if (!details) {
      return reply.code(404).send({ error: { ...ERROR_CODES.NOT_FOUND, message: "Transaction not found." } });
    }

    // C2 (b) — the captured transaction must carry our binding token. We set it as
    // order.invoiceNumber (which round-trips reliably); the transaction-level refId
    // is accepted only as a fallback. Reject if neither matches the issued refId.
    if (String(details.orderInvoiceNumber) !== String(refId) && String(details.refId) !== String(refId)) {
      return reply.code(403).send({ error: { ...ERROR_CODES.FORBIDDEN, message: "Transaction does not match the issued payment session." } });
    }

    // C2 (c) / M2 — only an APPROVED, captured/settled (or pending-settlement)
    // transaction may be recorded. Reject declined / voided / held / auth-only.
    const SETTLED_OR_PENDING = new Set(["capturedPendingSettlement", "settledSuccessfully"]);
    if (String(details.responseCode) !== "1" || !SETTLED_OR_PENDING.has(String(details.transactionStatus))) {
      return reply.code(422).send({
        error: {
          ...ERROR_CODES.VALIDATION_ERROR,
          message: `Transaction is not in a recordable state (status: ${details.transactionStatus || "unknown"}).`,
        },
      });
    }

    // C2 (d) — captured amount must equal the BOUND allocation sum.
    const allocSum = Math.round(
      (boundAllocations.reduce((s, a) => s + Number(a.amount || 0), 0) + Number.EPSILON) * 100
    ) / 100;
    if (Math.abs(details.amount - allocSum) > 0.01) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: `Allocation total ($${allocSum.toFixed(2)}) does not match the captured amount ($${details.amount.toFixed(2)}).` } });
    }

    // D1 — per-invoice mutex around the cap check + ledger record. The hosted
    // charge is already captured at the gateway; without this, two concurrent
    // completes for the same invoice could both pass the cap and both record,
    // over-applying the invoice in the local ledger. Lock every bound invoice
    // (sorted, deadlock-free) across verify-cap → record, releasing after the
    // ledger write (recordPaymentAndAllocations is soft-fail and never throws).
    let recorded;
    try {
      recorded = await withInvoiceLocks(
        redis,
        boundAllocations.map((a) => a.invoiceId),
        async () => {
          // C2 (e) + (f) — every BOUND allocation invoice belongs to the caller AND the
          // C1 over-allocation cap (no allocation exceeds the invoice's remaining balance).
          const v = await verifyAllocations(boundAllocations, request.user, { enforceCap: true });
          if (v) return { allocationError: v };
          return {
            result: await recordPaymentAndAllocations({
              user: request.user,
              amount: details.amount,
              transactionId: String(transId),
              allocations: boundAllocations,
              source: "doctor_hosted",
            }),
          };
        },
        { log: fastify.log }
      );
    } catch (err) {
      if (err instanceof InvoiceLockedError) return sendInvoiceLockedError(reply);
      throw err;
    }
    if (recorded.allocationError) return sendAllocationError(reply, recorded.allocationError);
    const { seazonaPaymentId, ledgerWriteFailed } = recorded.result;

    // One-time use — delete the binding so the same token/refId can't be replayed.
    await redis.del(`rxpay:hosted:${refId}`).catch(() => {});

    return {
      data: {
        transId,
        amount: details.amount,
        status: details.status,
        seazonaPaymentId,
        recorded: true,
        ...(ledgerWriteFailed ? { ledgerWriteFailed: true } : {}),
      },
    };
  });
}
