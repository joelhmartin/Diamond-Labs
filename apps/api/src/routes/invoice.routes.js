import { authenticate } from "../middleware/authenticate.js";
import { requireApprovedDoctor, requireAdmin } from "../middleware/require-role.js";
import * as seazonaService from "../services/seazona.service.js";
import { ERROR_CODES } from "@my-app/shared";
import { db } from "../config/database.js";
import { invoicePayments, users } from "../db/schema/index.js";
import { eq } from "drizzle-orm";
import { createId } from "../lib/id.js";
import { getPortalPaidMap, getInvoicePortalPaid } from "../services/invoice-ledger.service.js";
import * as auditService from "../services/audit.service.js";

/** Round to cents consistently (avoids FP drift). */
function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Normalize a Seazona invoice into the shape the frontend renders.
 *
 * Real Seazona invoice fields (from live API):
 *   id, invoiceNumber, patient, clientId, fullName, company,
 *   sales, tax, discounts, total, status, due, lastModified
 *
 * The Seazona API does NOT expose paid-vs-unpaid on the invoice itself —
 * `status` is a workflow state ("Shipped", "Hold", "In Production", …).
 *
 * @param {object} inv - Raw Seazona invoice object.
 * @param {number} [portalPaid=0] - Sum of payments recorded in the local
 *   invoice_payments ledger (Authorize.net charges made through this portal).
 *   Payments entered directly in Seazona by staff are NOT included here.
 */
function normalizeInvoice(inv, portalPaid = 0) {
  const total = Number(inv.total || 0);
  // Round to 2 decimal places; Drizzle returns numeric columns as strings.
  const portalPaidAmount = Math.round(parseFloat(portalPaid || 0) * 100) / 100;
  // Floor balance at 0 — over-payment should not produce a negative balance
  // that the UI could inadvertently multiply into a new charge.
  const portalBalance = Math.max(0, Math.round((total - portalPaidAmount) * 100) / 100);
  // Float epsilon: anything under half a cent is considered fully paid.
  const portalPaidFlag = portalBalance < 0.005;

  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    patient: inv.patient || "",
    clientId: inv.clientId || null,
    clientName: inv.fullName || inv.company || "",
    clientCompany: inv.company || "",
    sales: Number(inv.sales || 0),
    tax: Number(inv.tax || 0),
    discounts: Number(inv.discounts || 0),
    total,
    status: inv.status || "",
    due: inv.due || null,
    lastModified: inv.lastModified || null,
    // Portal-payment ledger fields (Authorize.net charges made via this portal
    // only — payments entered directly in Seazona are NOT reflected here).
    portalPaidAmount,
    portalBalance,
    portalPaid: portalPaidFlag,
  };
}

export default async function invoiceRoutes(fastify) {
  // ───────────────────────────────────────────────────────────────
  // ADMIN — all invoices across every client, enriched with client contact
  // info (one bulk listClients call — cheap vs N individual fetches).
  // Returns { invoices, clients, summary, statusCounts }.
  // ───────────────────────────────────────────────────────────────
  fastify.get("/admin/invoices", {
    preHandler: [authenticate, requireAdmin],
  }, async (request) => {
    const [invResult, clientList] = await Promise.all([
      request.query.lastModified
        ? seazonaService.getInvoicesResult(request.query.lastModified)
        : seazonaService.getAllInvoicesResult(),
      seazonaService.listClients(),
    ]);
    const seazonaUnavailable = !invResult.reachable;

    // Portal-payment fields default to 0 — admin bulk list has no per-user ledger context.
    const invoices = invResult.invoices.map(normalizeInvoice);

    // Index clients by id for lookup
    const clients = {};
    for (const c of clientList) {
      if (c.id) clients[c.id] = c;
    }

    // Unique status labels actually present in the data
    const statusCounts = {};
    for (const inv of invoices) {
      const s = inv.status || "Unknown";
      statusCounts[s] = (statusCounts[s] || 0) + 1;
    }

    const summary = {
      count: invoices.length,
      totalAmount: invoices.reduce((s, i) => s + i.total, 0),
      clientCount: new Set(invoices.map((i) => i.clientId).filter(Boolean)).size,
      statuses: statusCounts,
    };

    return { data: { invoices, clients, summary }, meta: { seazonaUnavailable } };
  });

  // ADMIN — single client detail (for expanding rows, etc.)
  fastify.get("/admin/clients/:id", {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const client = await seazonaService.getClient(request.params.id);
    if (!client) return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    return { data: client };
  });

  // List invoices for the current doctor's Seazona client
  fastify.get("/invoices", {
    preHandler: [authenticate, requireApprovedDoctor],
  }, async (request, reply) => {
    const { seazonaClientId } = request.user;

    if (!seazonaClientId) {
      return reply.code(400).send({ error: ERROR_CODES.SEAZONA_CLIENT_NOT_LINKED });
    }

    // Fetch Seazona invoices and the local portal-payment ledger in parallel.
    const [invResult, portalPaidMap] = await Promise.all([
      request.query.lastModified
        ? seazonaService.getInvoicesResult(request.query.lastModified)
        : seazonaService.getAllInvoicesResult(),
      getPortalPaidMap(request.user.id),
    ]);

    const doctorInvoices = invResult.invoices
      .filter((inv) => String(inv.clientId) === String(seazonaClientId))
      .map((inv) => normalizeInvoice(inv, portalPaidMap[String(inv.id)] || 0));

    // Tell the UI "billing system unreachable" apart from "you have no invoices":
    // an empty list with seazonaUnavailable=true is an outage, not a clean slate.
    return { data: doctorInvoices, meta: { seazonaUnavailable: !invResult.reachable } };
  });

  // Get a specific invoice
  fastify.get("/invoices/:id", {
    preHandler: [authenticate, requireApprovedDoctor],
  }, async (request, reply) => {
    const { seazonaClientId } = request.user;

    if (!seazonaClientId) {
      return reply.code(400).send({ error: ERROR_CODES.SEAZONA_CLIENT_NOT_LINKED });
    }

    const invoice = await seazonaService.getInvoice(request.params.id);
    if (!invoice) {
      return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    }

    // Ensure the invoice belongs to this doctor
    if (String(invoice.clientId) !== String(seazonaClientId)) {
      return reply.code(403).send({ error: ERROR_CODES.FORBIDDEN });
    }

    // Aggregate portal payments for this single invoice.
    const portalPaid = await getInvoicePortalPaid(request.user.id, String(request.params.id));

    // Audit PHI access — the invoice payload carries the patient name.
    auditService.logSafe({
      userId: request.user.id,
      action: "invoice.read",
      targetType: "invoice",
      targetId: String(request.params.id),
      ipAddress: request.ip,
    });

    return { data: normalizeInvoice(invoice, portalPaid) };
  });

  // ───────────────────────────────────────────────────────────────
  // ADMIN — record an OFFLINE payment (#4 mitigation). Payments that staff
  // entered DIRECTLY in Seazona are invisible to the portal balance (Seazona
  // exposes no readable paid-state). This lets an admin reflect such a payment
  // in the local invoice_payments ledger so the doctor's portal balance is
  // accurate. No Seazona write is made (the payment already exists there);
  // seazonaPaymentId is null and transactionId is an OFFLINE-<id> sentinel.
  //
  // Body: { amount, invoiceNumber?, seazonaClientId, userId? }. The ledger row's
  // userId is the invoice's doctor — resolved from seazonaClientId, or taken from
  // the body when provided. Capped at the invoice's remaining balance (C1 helper).
  // ───────────────────────────────────────────────────────────────
  fastify.post("/admin/invoices/:invoiceId/offline-payment", {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const invoiceId = String(request.params.invoiceId);
    const { amount, invoiceNumber, seazonaClientId, userId: bodyUserId } = request.body || {};

    const amt = Number(amount);
    if (!(amt > 0) || amt > 100000 || Number(amt.toFixed(2)) !== amt) {
      return reply.code(422).send({
        error: { ...ERROR_CODES.VALIDATION_ERROR, message: "amount must be a positive value (≤ 100000) with at most 2 decimals." },
      });
    }
    if (!seazonaClientId) {
      return reply.code(422).send({
        error: { ...ERROR_CODES.VALIDATION_ERROR, message: "seazonaClientId is required." },
      });
    }

    // The invoice must exist and belong to the named Seazona client.
    const invoice = await seazonaService.getInvoice(invoiceId);
    if (!invoice) {
      return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    }
    if (String(invoice.clientId) !== String(seazonaClientId)) {
      return reply.code(422).send({
        error: { ...ERROR_CODES.VALIDATION_ERROR, message: "Invoice does not belong to the given seazonaClientId." },
      });
    }

    // Resolve the doctor user for the ledger row: explicit userId wins, else the
    // user linked to this Seazona client.
    let ledgerUserId = bodyUserId || null;
    if (!ledgerUserId) {
      const [doctor] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.seazonaClientId, String(seazonaClientId)));
      ledgerUserId = doctor?.id || null;
    }
    if (!ledgerUserId) {
      return reply.code(422).send({
        error: { ...ERROR_CODES.VALIDATION_ERROR, message: "No portal user is linked to this seazonaClientId; pass an explicit userId." },
      });
    }

    // Cap at the invoice's remaining balance (C1 helper). Already-paid portion
    // is whatever the local ledger has recorded for THIS doctor + invoice.
    const alreadyPaid = await getInvoicePortalPaid(ledgerUserId, invoiceId);
    const remaining = round2(Number(invoice.total || 0) - alreadyPaid);
    if (amt > remaining + 0.005) {
      return reply.code(422).send({
        error: {
          ...ERROR_CODES.VALIDATION_ERROR,
          message: `Offline payment $${amt.toFixed(2)} exceeds the invoice's remaining balance of $${remaining.toFixed(2)}.`,
        },
      });
    }

    const rowId = createId();
    await db.insert(invoicePayments).values({
      id: rowId,
      userId: ledgerUserId,
      seazonaClientId: String(seazonaClientId),
      seazonaInvoiceId: invoiceId,
      invoiceNumber: invoiceNumber ? String(invoiceNumber) : (invoice.invoiceNumber != null ? String(invoice.invoiceNumber) : null),
      appliedAmount: amt.toFixed(2),
      transactionId: `OFFLINE-${rowId}`,
      seazonaPaymentId: null,
    });

    request.log.info(
      { invoiceId, seazonaClientId, ledgerUserId, amount: amt },
      "admin recorded offline payment in portal ledger"
    );

    // Durable audit trail (who recorded an offline payment). Soft-fail — the
    // ledger row is already written; audit must not break the response.
    await auditService.logSafe({
      userId: request.user.id,
      action: "payment.offline_recorded",
      targetType: "transaction",
      targetId: `OFFLINE-${rowId}`,
      metadata: { invoiceId, invoiceNumber: invoiceNumber || invoice.invoiceNumber || null, amount: amt, ledgerUserId },
      ipAddress: request.ip,
    });

    return { data: { invoiceId, amount: amt, recorded: true, userId: ledgerUserId } };
  });
}
