import { authenticate } from "../middleware/authenticate.js";
import { requireApprovedDoctor, requireAdmin } from "../middleware/require-role.js";
import * as seazonaService from "../services/seazona.service.js";
import { ERROR_CODES } from "@my-app/shared";
import { db } from "../config/database.js";
import { invoicePayments } from "../db/schema/index.js";
import { and, eq, sql } from "drizzle-orm";

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

/**
 * Return a plain object keyed by seazonaInvoiceId → totalPaidAmount for all
 * invoice_payments rows belonging to `userId`. One grouped SELECT — avoids N
 * queries on the list path. Amounts are numeric(12,2) → Drizzle returns strings;
 * we convert on the way out.
 *
 * On DB error the function logs and returns {} so callers degrade to showing no
 * portal-payment data rather than propagating a 500.
 *
 * @param {string} userId
 * @returns {Promise<Record<string, number>>}
 */
async function buildPortalPaidMap(userId) {
  try {
    const rows = await db
      .select({
        seazonaInvoiceId: invoicePayments.seazonaInvoiceId,
        totalPaid: sql`sum(${invoicePayments.appliedAmount})`.as("total_paid"),
      })
      .from(invoicePayments)
      .where(eq(invoicePayments.userId, userId))
      .groupBy(invoicePayments.seazonaInvoiceId);

    const map = {};
    for (const row of rows) {
      map[row.seazonaInvoiceId] = parseFloat(row.totalPaid || 0);
    }
    return map;
  } catch (err) {
    console.error("[invoiceRoutes] buildPortalPaidMap DB error — degrading to empty map:", err);
    return {};
  }
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
      buildPortalPaidMap(request.user.id),
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
    const invoiceId = String(request.params.id);
    let portalPaid = 0;
    try {
      const [paymentRow] = await db
        .select({
          totalPaid: sql`sum(${invoicePayments.appliedAmount})`.as("total_paid"),
        })
        .from(invoicePayments)
        .where(
          and(
            eq(invoicePayments.userId, request.user.id),
            eq(invoicePayments.seazonaInvoiceId, invoiceId)
          )
        );
      portalPaid = parseFloat(paymentRow?.totalPaid || 0);
    } catch (err) {
      request.log.error(
        { err },
        "[invoiceRoutes] portal payment aggregate failed for invoice %s — degrading to 0",
        invoiceId
      );
    }

    return { data: normalizeInvoice(invoice, portalPaid) };
  });
}
