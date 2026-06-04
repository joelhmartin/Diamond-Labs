import { authenticate } from "../middleware/authenticate.js";
import { requireApprovedDoctor, requireAdmin } from "../middleware/require-role.js";
import * as seazonaService from "../services/seazona.service.js";
import { ERROR_CODES } from "@my-app/shared";

/**
 * Normalize a Seazona invoice into the shape the frontend renders.
 *
 * Real Seazona invoice fields (from live API):
 *   id, invoiceNumber, patient, clientId, fullName, company,
 *   sales, tax, discounts, total, status, due, lastModified
 *
 * The Seazona API does NOT expose paid-vs-unpaid on the invoice itself —
 * `status` is a workflow state ("Shipped", "Hold", "In Production", …).
 * Payment reconciliation would require cross-referencing with /v1/payments,
 * which has no bulk list endpoint. For now we surface Seazona's own status.
 */
function normalizeInvoice(inv) {
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
    total: Number(inv.total || 0),
    status: inv.status || "",
    due: inv.due || null,
    lastModified: inv.lastModified || null,
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
    const [allRaw, clientList] = await Promise.all([
      request.query.lastModified
        ? seazonaService.getInvoices(request.query.lastModified)
        : seazonaService.getAllInvoices(),
      seazonaService.listClients(),
    ]);

    const invoices = allRaw.map(normalizeInvoice);

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

    return { data: { invoices, clients, summary } };
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

    // Fetch all invoices and filter by the doctor's client ID
    const allInvoices = request.query.lastModified
      ? await seazonaService.getInvoices(request.query.lastModified)
      : await seazonaService.getAllInvoices();
    const doctorInvoices = allInvoices
      .filter((inv) => String(inv.clientId) === String(seazonaClientId))
      .map(normalizeInvoice);

    return { data: doctorInvoices };
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

    return { data: invoice };
  });
}
