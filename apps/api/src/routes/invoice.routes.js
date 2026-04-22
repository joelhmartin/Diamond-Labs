import { authenticate } from "../middleware/authenticate.js";
import { requireApprovedDoctor } from "../middleware/require-role.js";
import * as seazonaService from "../services/seazona.service.js";
import { ERROR_CODES } from "@my-app/shared";

export default async function invoiceRoutes(fastify) {
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
