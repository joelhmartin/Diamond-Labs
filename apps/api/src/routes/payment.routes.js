import { authenticate } from "../middleware/authenticate.js";
import { requireApprovedDoctor, requireAdmin } from "../middleware/require-role.js";
import * as authorizenetService from "../services/authorizenet.service.js";
import { listPaymentsForUser, listAllPayments } from "../services/invoice-ledger.service.js";
import { db } from "../config/database.js";
import { users, auditLog } from "../db/schema/index.js";
import { eq, and, inArray, like, desc } from "drizzle-orm";
import { env } from "../config/env.js";
import { testModeError } from "../config/app-env.js";
import { ERROR_CODES } from "@my-app/shared";

// Checkout, saved cards, invoice payments and refunds live in their own route
// modules (checkout.routes.js, saved-cards.routes.js, invoice-payment.routes.js,
// refund.routes.js); shared replies in payment-replies.js. This module keeps
// payment history, the admin payment views and the admin-only test endpoints.

export default async function paymentRoutes(fastify) {
  // ───────────────────────────────────────────────────────────────
  // PAYMENT HISTORY (read-only)
  // ───────────────────────────────────────────────────────────────

  // Doctor — their OWN transaction-level payment history (charges + reversals
  // collapsed per charge). Drives the in-portal "Payments" view.
  fastify.get("/payments/history", {
    preHandler: [authenticate, requireApprovedDoctor],
  }, async (request) => {
    const payments = await listPaymentsForUser(request.user.id);
    return { data: { payments } };
  });

  // Admin — payment history across all doctors, enriched with the doctor's
  // name/email + a `refundable` flag so the UI can launch the refund modal on a
  // specific transaction. Optional `userId` scope and `q` free-text filter;
  // capped to `limit` (default 200, max 500) with a `truncated` flag so the UI
  // never silently hides rows.
  fastify.get("/admin/payments", {
    preHandler: [authenticate, requireAdmin],
  }, async (request) => {
    const { userId, q, limit } = request.query || {};
    let payments = await listAllPayments({ userId: userId || undefined });

    const ids = [...new Set(payments.map((p) => p.userId).filter(Boolean))];
    const userMap = {};
    if (ids.length) {
      const rows = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          seazonaAccountNumber: users.seazonaAccountNumber,
        })
        .from(users)
        .where(inArray(users.id, ids));
      for (const u of rows) userMap[u.id] = u;
    }

    payments = payments.map((p) => {
      const u = userMap[p.userId];
      return {
        ...p,
        doctorName: u?.name || null,
        doctorEmail: u?.email || null,
        accountNumber: u?.seazonaAccountNumber || null,
      };
    });

    if (q) {
      const needle = String(q).toLowerCase();
      payments = payments.filter(
        (p) =>
          String(p.transactionId).toLowerCase().includes(needle) ||
          (p.doctorName || "").toLowerCase().includes(needle) ||
          (p.doctorEmail || "").toLowerCase().includes(needle) ||
          (p.seazonaClientId || "").toLowerCase().includes(needle) ||
          p.invoices.some((inv) => String(inv.invoiceNumber || "").toLowerCase().includes(needle))
      );
    }

    const total = payments.length;
    const max = Math.min(Number(limit) > 0 ? Number(limit) : 200, 500);
    const sliced = payments.slice(0, max);
    return { data: { payments: sliced, total, truncated: total > sliced.length } };
  });

  // Admin — payment-action audit trail (who did what: charges, refunds/voids,
  // card changes). Optional `transactionId` scopes to one charge; newest first,
  // enriched with the actor's name/email. Read-only.
  fastify.get("/admin/payments/audit", {
    preHandler: [authenticate, requireAdmin],
  }, async (request) => {
    const { transactionId, limit } = request.query || {};
    const max = Math.min(Number(limit) > 0 ? Number(limit) : 100, 500);

    const conds = [like(auditLog.action, "payment.%")];
    if (transactionId) conds.push(eq(auditLog.targetId, String(transactionId)));

    const rows = await db
      .select()
      .from(auditLog)
      .where(and(...conds))
      .orderBy(desc(auditLog.createdAt))
      .limit(max);

    const ids = [...new Set(rows.map((r) => r.userId).filter(Boolean))];
    const userMap = {};
    if (ids.length) {
      const us = await db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(inArray(users.id, ids));
      for (const u of us) userMap[u.id] = u;
    }

    const entries = rows.map((r) => ({
      id: r.id,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      metadata: r.metadata || {},
      createdAt: r.createdAt,
      actorId: r.userId,
      actorName: r.userId ? userMap[r.userId]?.name || null : null,
      actorEmail: r.userId ? userMap[r.userId]?.email || null : null,
    }));

    return { data: { entries } };
  });

  // ───────────────────────────────────────────────────────────────
  // TEST — Accept Hosted (SAQ A) end-to-end check. Card data is entered on
  // Authorize.net's hosted iframe, never our DOM. These endpoints intentionally
  // do NOT write to Seazona or the invoice_payments ledger — they only exercise
  // the Authorize.net pipeline. `mode` defaults to sandbox; production is allowed
  // for a small real-charge smoke test (void it in the Authorize.net dashboard).
  // ───────────────────────────────────────────────────────────────
  // ADMIN-ONLY. These mint real production hosted-payment tokens for up to
  // $100,000 and read arbitrary transaction details, so `authenticate` alone is
  // not a guard — it would let any registered user (role "user") charge against
  // the live merchant account and enumerate other people's transactions.
  fastify.post("/payments/test/hosted-token", {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const { amount, mode = "sandbox", iframeCommunicatorUrl } = request.body || {};

    if (!(Number(amount) > 0) || Number(amount) > 100000) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "amount must be between 0 and 100000." } });
    }
    const modeError = testModeError(mode, env);
    if (modeError) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: modeError } });
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

  // ADMIN-ONLY — see the note on /payments/test/hosted-token. There is no
  // ownership check on `transId`, so without this guard any authenticated user
  // could read production transaction details (amount, card last-4, expiry) for
  // an arbitrary transaction id.
  fastify.post("/payments/test/hosted-complete", {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const { transId, mode = "sandbox" } = request.body || {};

    if (!transId) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "transId is required." } });
    }
    const modeError = testModeError(mode, env);
    if (modeError) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: modeError } });
    }

    const details = await authorizenetService.getTransactionDetails(transId, mode);
    if (!details) {
      return reply.code(404).send({ error: { ...ERROR_CODES.NOT_FOUND, message: "Transaction not found." } });
    }

    return { data: details };
  });
}
