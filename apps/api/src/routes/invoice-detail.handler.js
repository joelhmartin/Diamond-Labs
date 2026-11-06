import { ERROR_CODES } from "@my-app/shared";
import * as auditService from "../services/audit.service.js";
import { getInvoiceDetail } from "../services/billing/invoice-queries.js";
import { buildInvoiceModel } from "../services/billing/invoice-model.js";
import { renderInvoicePdf } from "../services/billing/billing-pdf.js";
import { sendInvoiceNotice } from "../services/email.service.js";
import { statementPdfFor } from "../services/billing/statements.service.js";
import { sendPdf } from "./pdf-reply.js";

/**
 * The one invoice read for the doctor and admin routes: the detail view and
 * the PDF share this access pattern, and only the access check and the
 * response differ.
 *   mayRead(user, detail)  → boolean; false (or no such invoice) answers 404,
 *                            never revealing existence
 *   view(detail)           → the allow-listed response body
 * Every read is audited (ids only): the invoice carries the patient's name.
 */

/** Load the invoice and apply `mayRead`; on a miss or failure the reply is already sent and this returns null. */
async function loadReadableInvoice(request, reply, mayRead, { withActivity = false, failure }) {
  let detail;
  try {
    detail = await getInvoiceDetail(request.params.id, { withActivity });
  } catch (err) {
    // Never echo the error: decrypt failures can carry PHI context.
    request.log.error({ invoiceId: request.params.id, err: err.message }, "invoice read failed");
    reply.code(500).send({ error: { ...ERROR_CODES.INTERNAL_ERROR, message: failure } });
    return null;
  }
  if (!detail || !mayRead(request.user, detail)) {
    reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    return null;
  }
  return detail;
}

export function invoiceDetailHandler({ mayRead, view, withActivity = false }) {
  return async (request, reply) => {
    const detail = await loadReadableInvoice(request, reply, mayRead, { withActivity, failure: "Failed to load invoice." });
    if (!detail) return reply;
    auditService.logSafe({ userId: request.user.id, action: "invoice.read", targetType: "invoice", targetId: detail.invoice.id, ipAddress: request.ip });
    return { data: view(detail) };
  };
}

/**
 * The invoice as a PDF, for either audience (same `mayRead` contract as the
 * detail handler). Built on request, never stored; sendPdf makes it no-store.
 */
export function invoicePdfHandler({ mayRead }) {
  return async (request, reply) => {
    const detail = await loadReadableInvoice(request, reply, mayRead, { failure: "Failed to build the invoice PDF." });
    if (!detail) return reply;
    let model;
    let pdf;
    try {
      model = buildInvoiceModel(detail.invoice, detail.lines, detail.client, detail.labOrder, { generatedAt: new Date() });
      pdf = await renderInvoicePdf(model);
    } catch (err) {
      request.log.error({ invoiceId: request.params.id, err: err.message }, "invoice pdf failed");
      return reply.code(500).send({ error: { ...ERROR_CODES.INTERNAL_ERROR, message: "Failed to build the invoice PDF." } });
    }
    auditService.logSafe({ userId: request.user.id, action: "invoice.pdf_downloaded", targetType: "invoice", targetId: detail.invoice.id, metadata: { invoiceNumber: model.invoiceNumber }, ipAddress: request.ip });
    return sendPdf(reply, pdf, model.filename);
  };
}

/**
 * A monthly statement PDF, for either audience; only how the subject is
 * chosen differs.
 *   subject(request) → { subject: "account", subjectId } | { subject: "organization", subjectId, organization }
 *     (may be async; may throw an app error with statusCode + code, e.g. 404
 *     NOT_FOUND for an out-of-scope `?account=` or 422 PRACTICE_REQUIRED,
 *     which the error handler sends as is)
 *     client: requestedStatementSubject over the login's scope
 *     admin:  the practice in the URL (or a client's single practice)
 * Not an active practice answers 404. Built on request, never stored; audited
 * with ids and the month only.
 */
export function statementPdfHandler({ subject }) {
  return async (request, reply) => {
    const s = await subject(request);
    let out;
    try {
      out = await statementPdfFor(s, request.query.month);
    } catch (err) {
      request.log.error({ subject: s.subject, subjectId: s.subjectId, err: err.message }, "statement pdf failed");
      return reply.code(500).send({ error: { ...ERROR_CODES.INTERNAL_ERROR, message: "Failed to build the statement." } });
    }
    if (!out) return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    auditService.logSafe({ userId: request.user.id, action: "statement.downloaded", targetType: s.subject, targetId: s.subjectId, metadata: { month: request.query.month }, ipAddress: request.ip });
    return sendPdf(reply, out.pdf, out.model.filename);
  };
}

/**
 * Staff presses "Email invoice": a short notice (number, amount, due date,
 * portal link) to the client. Only an issued invoice with a client email;
 * nothing clinical and no PDF leaves the system. Audited with ids only.
 */
export function invoiceEmailHandler() {
  return async (request, reply) => {
    const detail = await loadReadableInvoice(request, reply, () => true, { failure: "Failed to email the invoice." });
    if (!detail) return reply;
    const { invoice, client } = detail;
    const refuse = (message) => reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message } });
    if (invoice.status !== "issued") return refuse("Only an issued invoice can be emailed.");
    if (!client?.email) return refuse("This client has no email address on file.");
    const sent = await sendInvoiceNotice({
      to: client.email, invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber,
      totalCents: invoice.totalCents, balanceCents: invoice.balanceCents, dueDate: invoice.dueDate,
    });
    auditService.logSafe({ userId: request.user.id, action: "invoice.emailed", targetType: "invoice", targetId: invoice.id, metadata: { invoiceNumber: invoice.invoiceNumber, sent }, ipAddress: request.ip });
    return { data: { sent } };
  };
}
