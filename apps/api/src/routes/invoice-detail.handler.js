import { ERROR_CODES } from "@my-app/shared";
import * as auditService from "../services/audit.service.js";
import { getInvoiceDetail } from "../services/billing/invoice-queries.js";

/**
 * The one invoice-detail read, shared by the doctor and admin routes (and the
 * place a PDF/statement handler reuses). Only the access check and the
 * response shape differ:
 *   mayRead(user, detail)  → boolean; false answers 404 (never reveal existence)
 *   view(detail)           → the allow-listed response body
 * Every read is audited (ids only): the invoice carries the patient's name.
 */
export function invoiceDetailHandler({ mayRead, view, withActivity = false }) {
  return async (request, reply) => {
    let detail;
    try {
      detail = await getInvoiceDetail(request.params.id, { withActivity });
    } catch (err) {
      // Never echo the error: decrypt failures can carry PHI context.
      request.log.error({ invoiceId: request.params.id, err: err.message }, "invoice detail failed");
      return reply.code(500).send({ error: { ...ERROR_CODES.INTERNAL_ERROR, message: "Failed to load invoice." } });
    }
    if (!detail || !mayRead(request.user, detail)) return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    auditService.logSafe({ userId: request.user.id, action: "invoice.read", targetType: "invoice", targetId: detail.invoice.id, ipAddress: request.ip });
    return { data: view(detail) };
  };
}
