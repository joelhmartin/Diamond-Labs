import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { handlerSource } from "./_source.js";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const doctor = read("../invoice.routes.js");
const admin = read("../admin-invoice.routes.js");
const handler = read("../invoice-detail.handler.js");
const index = read("../../index.js");
const markersOf = (src) => [...src.matchAll(/\n  fastify\.(get|post|patch|put|delete)\("([^"]+)",/g)].map((m) => `fastify.${m[1]}("${m[2]}",`);

test("doctor invoice routes are approved-doctor only, scoped to the caller's practice, and never show a draft", () => {
  assert.match(doctor, /const DOCTOR = \[authenticate, requireApprovedDoctor\]/);
  for (const m of markersOf(doctor)) assert.match(handlerSource(doctor, m), /preHandler: (DOCTOR|\[\.\.\.DOCTOR)/, m);
  assert.match(handlerSource(doctor, 'fastify.get("/invoices",'), /listClientInvoices\(await practiceUserIds\(request\.user\)\)/);
  const detail = handlerSource(doctor, 'fastify.get("/invoices/:id",');
  assert.match(detail, /invoiceDetailHandler\(\{ mayRead, view: doctorInvoiceView \}\)/, "the shared handler, doctor access check and view");
  assert.match(doctor, /canActOnInvoice\(user, detail\.invoice, detail\.client\?\.seazonaClientId \?\? null\)/, "one shared predicate");
  assert.match(doctor, /detail\.invoice\.status !== "draft"/);
  assert.match(handler, /"invoice\.read"/, "every detail read is audited, in the one shared handler");
  assert.doesNotMatch(doctor, /seazonaService|seazona\.service/);
  assert.doesNotMatch(doctor + admin, /getInvoiceDetail/, "neither route file re-implements the detail read");
});

test("every admin billing route is admin-only: the lab role sees no money", () => {
  assert.match(admin, /export const ADMIN = \[authenticate, requireAdmin\]/);
  const markers = markersOf(admin);
  assert.ok(markers.length >= 3, "route discovery looks broken");
  for (const m of markers) assert.match(handlerSource(admin, m), /preHandler: (ADMIN|\[\.\.\.ADMIN)/, m);
  assert.match(handlerSource(admin, 'fastify.get("/admin/invoices",'), /validateQuery\(invoiceListQuerySchema\)/);
  assert.match(handlerSource(admin, 'fastify.get("/admin/invoices/:id",'), /invoiceDetailHandler\(\{ mayRead: \(\) => true, view: adminInvoiceView, withActivity: true \}\)/);
});

test("the server registers the billing routes", () => {
  assert.match(index, /await fastify\.register\(adminInvoiceRoutes, \{ prefix: "\/api\/v1" \}\)/);
  assert.match(index, /await fastify\.register\(invoiceRoutes, \{ prefix: "\/api\/v1" \}\)/);
});

test("staff actions validate their bodies and map invoice errors to replies", () => {
  const cases = [
    ['fastify.patch("/admin/invoices/:id/lines",', /validate\(invoiceEditSchema\)/, /editDraft\(/],
    ['fastify.post("/admin/invoices/:id/issue",', /validate\(invoiceIssueSchema\)/, /issueInvoice\(/],
    ['fastify.post("/admin/invoices/:id/void",', /validate\(invoiceVoidSchema\)/, /voidInvoice\(/],
    ['fastify.post("/admin/invoices/:id/credit",', /validate\(invoiceCreditSchema\)/, /recordCredit\(/],
    ['fastify.post("/admin/clients/:userId/payments",', /validate\(manualPaymentSchema\)/, /recordManualPayment\(/],
  ];
  for (const [marker, schema, call] of cases) {
    const body = handlerSource(admin, marker);
    assert.match(body, schema, marker);
    assert.match(body, call, marker);
    assert.match(body, /byUserId: request\.user\.id/, marker);
  }
  assert.match(admin, /invoiceErrorReply\(err\)/);
});

test("invoice PDFs: one shared handler; the doctor's practice's and never a draft; admins any; never cached; audited", () => {
  assert.match(handlerSource(doctor, 'fastify.get("/invoices/:id/pdf",'), /invoicePdfHandler\(\{ mayRead \}\)/, "the doctor's own access check");
  assert.match(handlerSource(admin, 'fastify.get("/admin/invoices/:id/pdf",'), /preHandler: ADMIN[\s\S]*invoicePdfHandler\(\{ mayRead: \(\) => true \}\)/);
  const pdf = handler.slice(handler.indexOf("export function invoicePdfHandler"));
  assert.match(pdf, /loadReadableInvoice\(request, reply, mayRead/, "the shared access pattern: 404 on no access, generic 500");
  assert.match(pdf, /sendPdf\(reply, pdf, model\.filename\)/);
  assert.match(pdf, /"invoice\.pdf_downloaded"/);
  assert.doesNotMatch(pdf, /patientName/, "the filename and audit never carry the patient");
  assert.match(read("../pdf-reply.js"), /"Cache-Control", "no-store"/);
});

const receivables = read("../receivables.routes.js");

test("AR, client statements and notices are admin-only and audited; nothing patient-bearing is emailed", () => {
  assert.match(receivables, /import \{ ADMIN \} from "\.\/admin-invoice\.routes\.js"/);
  for (const m of markersOf(receivables)) assert.match(handlerSource(receivables, m), /preHandler: \[\.\.\.ADMIN/, m);
  assert.match(handlerSource(receivables, 'fastify.get("/admin/receivables",'), /validateQuery\(receivablesQuerySchema\)/);
  const pdf = handlerSource(receivables, 'fastify.get("/admin/clients/:userId/statement.pdf",');
  assert.match(pdf, /statementPdfHandler\(\{/, "the one shared statement handler");
  assert.match(pdf, /clientUserId: request\.params\.userId/);
  assert.match(handlerSource(receivables, 'fastify.post("/admin/clients/:userId/statement/email",'), /"statement\.emailed"/);
  assert.match(handlerSource(admin, 'fastify.post("/admin/invoices/:id/email",'), /invoiceEmailHandler\(\)/);
  const mail = handler.slice(handler.indexOf("export function invoiceEmailHandler"));
  assert.match(mail, /"invoice\.emailed"/);
  assert.match(mail, /invoice\.status !== "issued"/);
  assert.doesNotMatch(mail, /patient/i);
  assert.match(index, /await fastify\.register\(receivablesRoutes, \{ prefix: "\/api\/v1" \}\)/);
});

test("one statement handler serves both audiences; a doctor's covers their practice, through the shared practice rule", () => {
  assert.match(handler, /export function statementPdfHandler\(\{ scope \}\)/);
  assert.match(handler, /sendPdf\(reply, out\.pdf, out\.model\.filename\)/);
  assert.match(handler, /"statement\.downloaded"/);
  const body = handlerSource(doctor, 'fastify.get("/invoices/statement.pdf",');
  assert.match(body, /\.\.\.DOCTOR, validateQuery\(statementQuerySchema\)/);
  assert.match(body, /statementPdfHandler\(/);
  assert.match(body, /clientUserIds: await practiceUserIds\(request\.user\)/);
  assert.doesNotMatch(doctor + receivables, /statementPdfFor|sendPdf/, "no near-duplicate handler");
});

test("the emailed statement notice covers the practice, like the doctor's own download", () => {
  const body = handlerSource(receivables, 'fastify.post("/admin/clients/:userId/statement/email",');
  assert.match(body, /statementFor\(request\.params\.userId, request\.body\.month, \{ clientUserIds: await practiceUserIds\(target\) \}\)/);
  assert.match(receivables, /import \{ practiceUserIds \} from "\.\.\/services\/billing\/ledger\.service\.js"/);
});
