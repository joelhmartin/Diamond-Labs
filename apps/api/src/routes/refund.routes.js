import { authenticate } from "../middleware/authenticate.js";
import { requireAdmin } from "../middleware/require-role.js";
import { validate } from "../middleware/validate.js";
import * as seazonaService from "../services/seazona.service.js";
import { sendRefundReceipt } from "../services/email.service.js";
import { voidOrRefund } from "../lib/void-refund.js";
import * as auditService from "../services/audit.service.js";
import { db } from "../config/database.js";
import { redis } from "../config/redis.js";
import { users, invoicePayments } from "../db/schema/index.js";
import { eq, and, gt } from "drizzle-orm";
import { createId } from "../lib/id.js";
import { env } from "../config/env.js";
import { ERROR_CODES, refundSchema } from "@my-app/shared";
import { withIdempotency, ChargeInProgressError, extractDeclineMessage } from "../lib/payment-helpers.js";
import { round2 } from "../lib/money.js";

export default async function refundRoutes(fastify) {
  // ───────────────────────────────────────────────────────────────
  // ADMIN REFUND / VOID — reverse a payment recorded through the portal.
  //
  // Voids an unsettled charge or refunds a settled one at Authorize.net, then
  // reverses the LOCAL ledger (one negative invoice_payments row per original
  // row) so the affected invoices un-pay. Money-critical: the gateway call is
  // the only thing that may fail loudly; everything after it (ledger reversal,
  // Seazona credit, receipt) is best-effort — once the money is back at the
  // gateway we must not 500 and invite a re-attempt.
  //
  // Supports FULL or PARTIAL-by-invoice reversal (see refundSchema):
  //   • no `allocations` → full reversal of every original row;
  //   • `allocations` → reverse specific invoice slices, each capped at what it
  //     was charged. Partial is settled-only (Authorize.net can't partially VOID
  //     an unsettled charge — the gateway helper rejects that as a 422).
  // ONE reversal per charge either way: the double-refund guard rejects a second
  // refund on a charge that already has any reversal row (so a charge is refunded
  // once, fully or partially — incremental top-ups are a future enhancement).
  //
  // Concurrency: the double-refund guard + gateway reversal + ledger insert +
  // Seazona credit + receipt all run inside withIdempotency keyed on the
  // charge's transaction id, so two concurrent refunds of the same charge
  // serialize on the lock (the loser gets 409 CHARGE_IN_PROGRESS, or replays the
  // cached result instead of double-refunding). Nothing after the voidOrRefund
  // gateway call may throw out of the locked fn (ledger insert is soft-failed,
  // Seazona + receipt never throw), so a successful reversal is always cached,
  // never followed by a lock release that could permit a re-refund.
  // ───────────────────────────────────────────────────────────────
  fastify.post("/admin/payments/refund", {
    preHandler: [authenticate, requireAdmin, validate(refundSchema)],
  }, async (request, reply) => {
    const { transactionId, allocations } = request.body;
    const txid = String(transactionId);

    // 1. Find the ORIGINAL charge's ledger rows (positive applied only — never
    // match a prior refund's negative rows). We only refund payments we recorded.
    const originalRows = await db
      .select()
      .from(invoicePayments)
      .where(and(eq(invoicePayments.transactionId, txid), gt(invoicePayments.appliedAmount, "0")));
    if (!originalRows.length) {
      return reply.code(404).send({
        error: { ...ERROR_CODES.NOT_FOUND, message: "No portal payment found for that transaction id." },
      });
    }

    // 2. Reversal plan.
    //   • No `allocations` → FULL reversal: negate every original row.
    //   • `allocations` → PARTIAL: reverse only the specified invoice slices,
    //     each capped at what that invoice was charged. Validated here (read-only,
    //     no money moves) before the lock. Settled-only is enforced by the gateway
    //     helper (Authorize.net can't partially void an unsettled charge).
    let partialPlan = null; // null ⇒ full reversal
    if (allocations) {
      const appliedByInvoice = new Map();
      const numberByInvoice = new Map();
      for (const r of originalRows) {
        const prev = appliedByInvoice.get(r.seazonaInvoiceId) || 0;
        appliedByInvoice.set(r.seazonaInvoiceId, round2(prev + Number(r.appliedAmount)));
        if (r.invoiceNumber && !numberByInvoice.has(r.seazonaInvoiceId)) {
          numberByInvoice.set(r.seazonaInvoiceId, r.invoiceNumber);
        }
      }
      const seen = new Set();
      for (const a of allocations) {
        const invId = String(a.invoiceId);
        if (!appliedByInvoice.has(invId)) {
          return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: `Invoice ${invId} is not part of this charge.` } });
        }
        if (seen.has(invId)) {
          return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: `Invoice ${invId} appears more than once.` } });
        }
        seen.add(invId);
        if (round2(Number(a.amount)) > appliedByInvoice.get(invId) + 0.005) {
          return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: `Refund for invoice ${invId} exceeds the $${appliedByInvoice.get(invId).toFixed(2)} charged to it.` } });
        }
      }
      partialPlan = {
        total: round2(allocations.reduce((s, a) => s + Number(a.amount), 0)),
        rows: allocations.map((a) => ({
          seazonaInvoiceId: String(a.invoiceId),
          invoiceNumber: numberByInvoice.get(String(a.invoiceId)) || null,
          appliedAmount: (-round2(Number(a.amount))).toFixed(2),
        })),
      };
    }

    // 3. Critical section under an idempotency lock keyed on the charge txn id.
    // Concurrent refunds serialize here; the double-refund guard lives INSIDE the
    // lock so check-then-act can't race, and everything after the gateway call is
    // soft-fail so a successful reversal is cached rather than lock-released.
    let outcome;
    try {
      outcome = await withIdempotency(
        redis,
        `refund:${txid}`,
        async () => {
          // 3a. Double-refund guard — a reversal row linked to this charge already
          // exists. Throw a tagged error → 409 ALREADY_REFUNDED. Throwing here
          // releases the lock, which is safe: no money has moved.
          const existingRefund = await db
            .select({ id: invoicePayments.id })
            .from(invoicePayments)
            .where(eq(invoicePayments.refundsTransactionId, txid));
          if (existingRefund.length) {
            throw Object.assign(new Error("already_refunded"), { alreadyRefunded: true });
          }

          // 3b. Look up the doctor BEFORE the gateway call so a DB hiccup throws
          // while it's still safe (no money moved → lock releases → retryable).
          const refundUser = (await db.select().from(users).where(eq(users.id, originalRows[0].userId)))[0] || null;

          // 3c. WRITE-AHEAD guard: persist a durable double-refund marker BEFORE
          // touching the gateway. If the process dies between the gateway reversal
          // and the ledger write, this row still blocks a re-refund on retry (the
          // idempotency cache wouldn't survive a crash). It's rolled back only if
          // the gateway call itself fails (no money moved → safe to retry).
          const guardRowId = createId();
          await db.insert(invoicePayments).values({
            id: guardRowId,
            userId: originalRows[0].userId,
            seazonaClientId: originalRows[0].seazonaClientId || null,
            seazonaInvoiceId: originalRows[0].seazonaInvoiceId,
            invoiceNumber: originalRows[0].invoiceNumber || null,
            appliedAmount: "0.00",
            transactionId: `REFUND-PENDING-${txid}`,
            refundsTransactionId: txid,
            seazonaPaymentId: null,
          });

          // 3d. Reverse at the gateway (void if unsettled, refund if settled).
          // FULL when no plan; PARTIAL passes the requested total (settled-only —
          // voidOrRefund rejects a partial amount on an unsettled charge).
          //
          // On failure, only roll back the write-ahead guard when we have
          // DEFINITIVE proof no money moved:
          //   • a pre-gateway validation/not-found error (refundErrorKind), or
          //   • a gateway response that explicitly REJECTED the reversal
          //     (authNetResponse present → the credit/void was never created).
          // For an UNCERTAIN failure — socket reset / timeout / unparseable body
          // after the request reached Authorize.net — the charge MAY already be
          // reversed, so we KEEP the guard row to block a retry from issuing a
          // second reversal, and surface a reconcile-manually error instead.
          let result;
          try {
            result = await voidOrRefund(txid, partialPlan ? partialPlan.total : undefined);
          } catch (gwErr) {
            const definitivelyNoMoneyMoved = !!gwErr.refundErrorKind || !!gwErr.authNetResponse;
            if (definitivelyNoMoneyMoved) {
              await db.delete(invoicePayments).where(eq(invoicePayments.id, guardRowId)).catch(() => {});
              throw gwErr;
            }
            console.error(
              `[PAYMENT][REFUND_UNCERTAIN] reversal of charge ${txid} failed without a definitive gateway response — the charge MAY already be reversed; guard row ${guardRowId} kept to block a retry, manual reconcile required ` +
                JSON.stringify({ transactionId: txid, error: String(gwErr?.message || gwErr).slice(0, 300) })
            );
            throw Object.assign(gwErr, { refundUncertain: true });
          }

          // The money is now reversed at Authorize.net. Everything below is
          // best-effort and MUST NOT throw — otherwise the lock would release and
          // permit a re-refund.
          const refundTxnId = result.transactionId || `REFUND-${txid}`;
          const refundedAmount = round2(Number(result.amount));

          // 4. Reverse the LOCAL ledger. FULL → negate every original row.
          // PARTIAL → one negative row per requested invoice slice (validated
          // above to not exceed what each invoice was charged). Either way the
          // rows sum to exactly what was reversed at the gateway, so per-invoice
          // totals stay consistent.
          // M3 — tag every reversal row `source: "refund"`. Before this, no
          // runtime path ever wrote it (only the one-off backfill script
          // guessed it retroactively from the transactionId prefix), so a
          // refund recorded through the live admin flow showed no source at
          // all in both payment history views — the one origin they could
          // have derived with certainty (this IS the refund code path) was
          // the one left blank.
          const reversalRows = partialPlan
            ? partialPlan.rows.map((r) => ({
                id: createId(),
                userId: originalRows[0].userId,
                seazonaClientId: originalRows[0].seazonaClientId || null,
                seazonaInvoiceId: r.seazonaInvoiceId,
                invoiceNumber: r.invoiceNumber,
                appliedAmount: r.appliedAmount,
                transactionId: refundTxnId,
                refundsTransactionId: txid,
                seazonaPaymentId: null,
                source: "refund",
              }))
            : originalRows.map((r) => ({
                id: createId(),
                userId: r.userId,
                seazonaClientId: r.seazonaClientId || null,
                seazonaInvoiceId: r.seazonaInvoiceId,
                invoiceNumber: r.invoiceNumber || null,
                appliedAmount: (-Number(r.appliedAmount)).toFixed(2),
                transactionId: refundTxnId,
                refundsTransactionId: txid,
                seazonaPaymentId: null,
                source: "refund",
              }));

          let ledgerWriteFailed = false;
          try {
            await db.insert(invoicePayments).values(reversalRows);
          } catch (ledgerErr) {
            ledgerWriteFailed = true;
            console.error(
              `[PAYMENT][REFUND_LEDGER_WRITE_FAILED] refund/void ${refundTxnId} for charge ${txid} succeeded at Authorize.net but the ledger reversal insert failed — manual reconcile required ` +
                JSON.stringify({
                  transactionId: txid,
                  refundTransactionId: refundTxnId,
                  action: result.action,
                  amount: refundedAmount,
                  invoices: reversalRows.map((r) => r.invoiceNumber || r.seazonaInvoiceId),
                  error: String(ledgerErr?.message || ledgerErr).slice(0, 300),
                })
            );
            // No extra guard needed here — the write-ahead guard row (3c, inserted
            // BEFORE the gateway call) already blocks a re-refund of this charge.
          }

          // 5. Seazona credit (best-effort, never throws). Mirrors the
          // production-only gating of recordPaymentAndAllocations — no sandbox.
          if (originalRows[0].seazonaClientId && env.AUTHORIZE_NET_ENV === "production") {
            try {
              const invNums = [...new Set(reversalRows.map((r) => r.invoiceNumber).filter(Boolean))];
              const res = await seazonaService.createPayment({
                clientId: originalRows[0].seazonaClientId,
                accountNumber: refundUser?.seazonaAccountNumber || null,
                // Same "Invoices <num>" token the original payment used — Seazona's
                // report attributes by that, so the negative credit lands on the
                // right invoices. The refund context lives in notes.
                referenceNumber: invNums.length ? `Invoices ${invNums.join(", ")}` : `Refund ${txid}`,
                notes: `[REFUND] txn ${txid}`,
                amount: -refundedAmount,
              });
              const seazonaPaymentId = res?.paymentId ?? res?.id ?? res?.PaymentId ?? res?.paymentID ?? null;
              if (!seazonaPaymentId) {
                console.error(
                  `[Seazona][REFUND_WRITE_FAILED] refund ${refundTxnId} for charge ${txid} reversed at Authorize.net but did NOT record a Seazona credit — manual entry required ` +
                    JSON.stringify({
                      transactionId: txid,
                      clientId: originalRows[0].seazonaClientId,
                      accountNumber: refundUser?.seazonaAccountNumber || null,
                      amount: -refundedAmount,
                      invoices: invNums,
                    })
                );
              }
            } catch (seazonaErr) {
              console.error(
                `[Seazona][REFUND_WRITE_FAILED] refund ${refundTxnId} for charge ${txid} reversed at Authorize.net but the Seazona credit threw — manual entry required ` +
                  JSON.stringify({
                    transactionId: txid,
                    clientId: originalRows[0].seazonaClientId,
                    amount: -refundedAmount,
                    error: String(seazonaErr?.message || seazonaErr).slice(0, 300),
                  })
              );
            }
          }

          // 6. Refund receipt to the doctor — soft-fail.
          if (refundUser?.email) {
            try {
              await sendRefundReceipt({
                to: refundUser.email,
                amount: refundedAmount,
                invoices: reversalRows.map((r) => ({
                  number: r.invoiceNumber || r.seazonaInvoiceId,
                  amount: Math.abs(Number(r.appliedAmount)),
                })),
                transactionId: txid,
                date: new Date(),
              });
            } catch {
              /* send() never throws; belt-and-suspenders */
            }
          }

          // 7. Audit log (ids/amounts only — no card or patient data). A
          // console line for log-based alerting PLUS a durable audit_log row
          // (who refunded what) for the admin payments view. Inside the
          // idempotent block so a replay doesn't double-record; soft-fail.
          const refundAudit = {
            admin: request.user.id,
            transactionId: txid,
            action: result.action,
            amount: refundedAmount,
            invoices: reversalRows.map((r) => r.invoiceNumber || r.seazonaInvoiceId),
          };
          console.log("[PAYMENT][REFUND] " + JSON.stringify(refundAudit));
          await auditService.logSafe({
            userId: request.user.id,
            action: "payment.refund",
            targetType: "transaction",
            targetId: txid,
            metadata: {
              kind: result.action, // "void" | "refund"
              partial: !!partialPlan,
              amount: refundedAmount,
              refundTransactionId: refundTxnId,
              invoices: refundAudit.invoices,
              ledgerWriteFailed,
            },
            ipAddress: request.ip,
          });

          return {
            action: result.action,
            refundTransactionId: refundTxnId,
            amount: result.amount,
            ...(ledgerWriteFailed ? { ledgerWriteFailed: true } : {}),
          };
        },
        { log: fastify.log }
      );
    } catch (err) {
      if (err?.alreadyRefunded) {
        return reply.code(409).send({ error: ERROR_CODES.ALREADY_REFUNDED });
      }
      if (err instanceof ChargeInProgressError) {
        return reply.code(409).send({ error: ERROR_CODES.CHARGE_IN_PROGRESS });
      }
      if (err?.refundErrorKind === "not_found") {
        return reply.code(404).send({ error: { ...ERROR_CODES.NOT_FOUND, message: err.message } });
      }
      if (err?.refundErrorKind === "validation") {
        return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: err.message } });
      }
      // Outcome unknown — the reversal may already have gone through. Tell the
      // admin NOT to retry and to reconcile manually (the guard row stays).
      if (err?.refundUncertain) {
        return reply.code(ERROR_CODES.REFUND_UNCERTAIN.status).send({ error: ERROR_CODES.REFUND_UNCERTAIN });
      }
      fastify.log.warn({ transactionId: txid, err: String(err?.message || err) }, "refund gateway call failed");
      // A refund/void gateway error is NOT a card decline — never map it to
      // CARD_DECLINED. Surface the gateway's own rejection text when present,
      // otherwise a generic REFUND_FAILED.
      if (err?.authNetResponse) {
        const message = extractDeclineMessage(err.authNetResponse) || ERROR_CODES.REFUND_FAILED.message;
        return reply.code(ERROR_CODES.REFUND_FAILED.status).send({ error: { ...ERROR_CODES.REFUND_FAILED, message } });
      }
      return reply.code(ERROR_CODES.REFUND_FAILED.status).send({ error: ERROR_CODES.REFUND_FAILED });
    }

    return { data: outcome.result };
  });
}
