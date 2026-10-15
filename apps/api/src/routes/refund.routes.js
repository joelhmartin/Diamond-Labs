import { authenticate } from "../middleware/authenticate.js";
import { requireAdmin } from "../middleware/require-role.js";
import { validate } from "../middleware/validate.js";
import { sendRefundReceipt } from "../services/email.service.js";
import { voidOrRefund } from "../lib/void-refund.js";
import * as auditService from "../services/audit.service.js";
import { db } from "../config/database.js";
import { redis } from "../config/redis.js";
import { users, invoicePayments } from "../db/schema/index.js";
import { and, eq, gt, isNull, notInArray, or } from "drizzle-orm";
import { createId } from "../lib/id.js";
import { toCents } from "../lib/money.js";
import { planRefund, invoiceKeysOf } from "../lib/refund-plan.js";
import { ERROR_CODES, refundSchema, SHOP_PAYMENT_SOURCE, CREDIT_SOURCE } from "@my-app/shared";
import { withIdempotency, ChargeInProgressError, extractDeclineMessage } from "../lib/payment-helpers.js";

const invoiceRef = (r) => r.invoiceNumber || r.invoiceId || r.seazonaInvoiceId;

export default async function refundRoutes(fastify) {
  // ───────────────────────────────────────────────────────────────
  // ADMIN REFUND / VOID: reverse a card payment recorded through the portal.
  //
  // Voids an unsettled charge or refunds a settled one at Authorize.net, then
  // reverses OUR ledger (negative invoice_payments rows), which reopens the
  // invoices' balances. Nothing is written to the legacy lab system (own-the-lab piece 3).
  // FULL (no allocations) or PARTIAL by invoice slice (settled charges only).
  // ONE reversal per charge: the double-refund guard rejects a second one.
  //
  // Concurrency: guard + gateway reversal + ledger + receipt run inside
  // withIdempotency keyed on the charge's transaction id. Nothing after the
  // gateway call may throw out of the locked fn, so a successful reversal is
  // always cached rather than followed by a lock release that permits a re-refund.
  // ───────────────────────────────────────────────────────────────
  fastify.post("/admin/payments/refund", {
    preHandler: [authenticate, requireAdmin, validate(refundSchema)],
  }, async (request, reply) => {
    const { transactionId, allocations } = request.body;
    const txid = String(transactionId);

    // 1. The ORIGINAL charge's rows (positive only). Shop checkouts and staff
    //    credits are not portal card payments: never refunded here.
    const originalRows = await db
      .select()
      .from(invoicePayments)
      .where(and(
        eq(invoicePayments.transactionId, txid),
        gt(invoicePayments.appliedCents, 0),
        or(isNull(invoicePayments.source), notInArray(invoicePayments.source, [SHOP_PAYMENT_SOURCE, CREDIT_SOURCE])),
      ));
    if (!originalRows.length) {
      return reply.code(404).send({ error: { ...ERROR_CODES.NOT_FOUND, message: "No portal payment found for that transaction id." } });
    }

    // 2. The reversal plan (read-only; no money moves yet).
    const plan = planRefund(originalRows, allocations);
    if (plan.error) return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: plan.error } });

    let outcome;
    try {
      outcome = await withIdempotency(
        redis,
        `refund:${txid}`,
        async () => {
          // 3a. Double-refund guard (inside the lock, so check-then-act can't race).
          const existingRefund = await db
            .select({ id: invoicePayments.id })
            .from(invoicePayments)
            .where(eq(invoicePayments.refundsTransactionId, txid));
          if (existingRefund.length) throw Object.assign(new Error("already_refunded"), { alreadyRefunded: true });

          // 3b. Read the doctor BEFORE the gateway call, while a DB error is still safe.
          const refundUser = originalRows[0].userId
            ? (await db.select().from(users).where(eq(users.id, originalRows[0].userId)))[0] || null
            : null;

          // 3c. WRITE-AHEAD guard: a durable double-refund marker before touching
          //     the gateway, rolled back only if the gateway definitely moved no money.
          const guardRowId = createId();
          await db.insert(invoicePayments).values({
            id: guardRowId,
            ...invoiceKeysOf(originalRows[0]),
            userId: originalRows[0].userId ?? null,
            appliedCents: 0,
            transactionId: `REFUND-PENDING-${txid}`,
            refundsTransactionId: txid,
          });

          // 3d. Reverse at the gateway (void if unsettled, refund if settled).
          //     Dollars only on the wire.
          let result;
          try {
            result = await voidOrRefund(txid, plan.totalCents == null ? undefined : plan.totalCents / 100);
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

          // The money is back at the gateway. Nothing below may throw.
          const refundTxnId = result.transactionId || `REFUND-${txid}`;
          const refundedCents = toCents(result.amount);

          // 4. Reverse OUR ledger: rows that sum to exactly what was reversed.
          const reversalRows = plan.rows.map((r) => ({
            id: createId(), ...r, transactionId: refundTxnId, refundsTransactionId: txid, source: "refund",
          }));
          let ledgerWriteFailed = false;
          try {
            await db.insert(invoicePayments).values(reversalRows);
          } catch (ledgerErr) {
            ledgerWriteFailed = true;
            console.error(
              `[PAYMENT][REFUND_LEDGER_WRITE_FAILED] refund/void ${refundTxnId} for charge ${txid} succeeded at Authorize.net but the ledger reversal insert failed — manual reconcile required ` +
                JSON.stringify({
                  transactionId: txid, refundTransactionId: refundTxnId, action: result.action, amountCents: refundedCents,
                  invoices: reversalRows.map(invoiceRef), error: String(ledgerErr?.message || ledgerErr).slice(0, 300),
                })
            );
            // The write-ahead guard row (3c) already blocks a re-refund.
          }

          // 5. Refund receipt (soft-fail).
          if (refundUser?.email) {
            try {
              await sendRefundReceipt({
                to: refundUser.email,
                amountCents: refundedCents,
                invoices: reversalRows.map((r) => ({ number: invoiceRef(r), amountCents: -r.appliedCents })),
                transactionId: txid,
                date: new Date(),
              });
            } catch {
              /* deliver() never throws */
            }
          }

          // 6. Audit (ids and amounts only), inside the idempotent block so a replay doesn't double-record.
          const invoicesRef = reversalRows.map(invoiceRef);
          console.log("[PAYMENT][REFUND] " + JSON.stringify({ admin: request.user.id, transactionId: txid, action: result.action, amountCents: refundedCents, invoices: invoicesRef }));
          await auditService.logSafe({
            userId: request.user.id,
            action: "payment.refund",
            targetType: "transaction",
            targetId: txid,
            metadata: {
              kind: result.action,
              partial: plan.totalCents != null,
              amountCents: refundedCents,
              refundTransactionId: refundTxnId,
              invoices: invoicesRef,
              ledgerWriteFailed,
            },
            ipAddress: request.ip,
          });

          return {
            action: result.action,
            refundTransactionId: refundTxnId,
            amountCents: refundedCents,
            ...(ledgerWriteFailed ? { ledgerWriteFailed: true } : {}),
          };
        },
        { log: fastify.log }
      );
    } catch (err) {
      if (err?.alreadyRefunded) return reply.code(409).send({ error: ERROR_CODES.ALREADY_REFUNDED });
      if (err instanceof ChargeInProgressError) return reply.code(409).send({ error: ERROR_CODES.CHARGE_IN_PROGRESS });
      if (err?.refundErrorKind === "not_found") return reply.code(404).send({ error: { ...ERROR_CODES.NOT_FOUND, message: err.message } });
      if (err?.refundErrorKind === "validation") return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: err.message } });
      // Outcome unknown: tell the admin NOT to retry (the guard row stays).
      if (err?.refundUncertain) return reply.code(ERROR_CODES.REFUND_UNCERTAIN.status).send({ error: ERROR_CODES.REFUND_UNCERTAIN });
      fastify.log.warn({ transactionId: txid, err: String(err?.message || err) }, "refund gateway call failed");
      // A refund/void gateway error is not a card decline.
      if (err?.authNetResponse) {
        const message = extractDeclineMessage(err.authNetResponse) || ERROR_CODES.REFUND_FAILED.message;
        return reply.code(ERROR_CODES.REFUND_FAILED.status).send({ error: { ...ERROR_CODES.REFUND_FAILED, message } });
      }
      return reply.code(ERROR_CODES.REFUND_FAILED.status).send({ error: ERROR_CODES.REFUND_FAILED });
    }

    return { data: outcome.result };
  });
}
