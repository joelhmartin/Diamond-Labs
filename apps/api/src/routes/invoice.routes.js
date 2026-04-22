import { authenticate } from "../middleware/authenticate.js";
import { requireApprovedDoctor, requireAdmin } from "../middleware/require-role.js";
import * as seazonaService from "../services/seazona.service.js";
import { ERROR_CODES } from "@my-app/shared";

/**
 * Normalize a Seazona invoice into a consistent shape for the frontend.
 * Seazona's field names vary across endpoints, so coalesce the common keys.
 */
function normalizeInvoice(inv) {
  const amount = Number(inv.amount ?? inv.total ?? inv.totalAmount ?? 0);
  const paidAmount = Number(inv.paidAmount ?? inv.amountPaid ?? 0);
  const balance = Number(inv.balance ?? Math.max(0, amount - paidAmount));
  const statusRaw = (inv.status || inv.state || "").toLowerCase();

  let status = "unpaid";
  if (statusRaw === "paid" || inv.paid === true || balance === 0 && amount > 0) {
    status = "paid";
  } else if (statusRaw === "void" || statusRaw === "cancelled" || statusRaw === "canceled") {
    status = "void";
  } else if (paidAmount > 0 && balance > 0) {
    status = "partial";
  }

  return {
    id: inv.id ?? inv.invoiceId ?? inv.invoiceNumber,
    invoiceNumber: inv.invoiceNumber ?? inv.id ?? inv.invoiceId,
    clientId: inv.clientId ?? inv.client_id ?? null,
    amount,
    paidAmount,
    balance,
    status,
    dueDate: inv.dueDate ?? inv.due ?? null,
    issueDate: inv.issueDate ?? inv.date ?? inv.createdAt ?? null,
    description: inv.description ?? inv.notes ?? "",
    raw: inv,
  };
}

/** Run `fn` over `items` with at most `limit` concurrent calls. */
async function mapConcurrent(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      try {
        results[idx] = await fn(items[idx], idx);
      } catch {
        results[idx] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export default async function invoiceRoutes(fastify) {
  // ───────────────────────────────────────────────────────────────
  // ADMIN — all invoices across every client, with client enrichment.
  // Returns { invoices, clients, summary } where clients is a { [clientId]: client }
  // map and summary holds aggregate totals.
  // ───────────────────────────────────────────────────────────────
  fastify.get("/admin/invoices", {
    preHandler: [authenticate, requireAdmin],
  }, async (request) => {
    const allRaw = await seazonaService.getInvoices(request.query.lastModified);
    const invoices = allRaw.map(normalizeInvoice);

    // Unique client IDs
    const clientIds = [...new Set(invoices.map((i) => i.clientId).filter(Boolean))];

    // Enrich — concurrency-limited so we don't blast Seazona
    const fetched = await mapConcurrent(clientIds, 5, (id) =>
      seazonaService.getClient(id)
    );
    const clients = {};
    clientIds.forEach((id, idx) => {
      if (fetched[idx]) clients[id] = fetched[idx];
    });

    // Aggregate summary
    const summary = {
      count: invoices.length,
      totalAmount: invoices.reduce((s, i) => s + i.amount, 0),
      totalBalance: invoices.reduce((s, i) => s + i.balance, 0),
      paidCount: invoices.filter((i) => i.status === "paid").length,
      unpaidCount: invoices.filter((i) => i.status === "unpaid").length,
      partialCount: invoices.filter((i) => i.status === "partial").length,
      clientCount: clientIds.length,
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
    const allInvoices = await seazonaService.getInvoices(request.query.lastModified);
    const doctorInvoices = allInvoices.filter(
      (inv) => String(inv.clientId) === String(seazonaClientId)
    );

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
