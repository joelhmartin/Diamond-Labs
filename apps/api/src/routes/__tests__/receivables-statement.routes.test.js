import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

/**
 * The admin's per-client statement paths are thin wrappers onto the client's
 * single practice: a client in two practices is refused (422, use the
 * practice's own statement); one practice → that practice's statement.
 */

vi.mock("../../middleware/authenticate.js", () => ({ authenticate: async (request) => { request.user = { id: "adm", role: "admin" }; } }));
vi.mock("../../services/audit.service.js", () => ({ logSafe: () => {}, log: async () => {} }));

let practicesOf = {};
vi.mock("../../services/practice-of.js", async (importOriginal) => ({
  ...(await importOriginal()),
  directPracticeIdsQuery: async (_db, userId) => (practicesOf[userId] ?? []).map((accountId) => ({ accountId })),
}));
const pdfCalls = [];
vi.mock("../../services/billing/statements.service.js", async (importOriginal) => ({
  ...(await importOriginal()),
  statementPdfFor: async (subject, month) => { pdfCalls.push({ subject, month }); return { model: { filename: "statement.pdf" }, pdf: Buffer.from("%PDF-1.4 test") }; },
}));
const sendCalls = [];
let sendResult = null;
vi.mock("../../services/billing/statement-run.service.js", async (importOriginal) => ({
  ...(await importOriginal()),
  sendStatementFor: async (...args) => { sendCalls.push(args); return sendResult; },
}));

const { default: receivablesRoutes } = await import("../receivables.routes.js");
const { errorHandler } = await import("../../middleware/error-handler.js");

async function call(method, url, payload) {
  const app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(receivablesRoutes, { prefix: "/api/v1" });
  const res = await app.inject({ method, url: `/api/v1${url}`, payload });
  await app.close();
  return res;
}

beforeEach(() => {
  practicesOf = { one: ["A1"], two: ["A1", "A2"] };
  pdfCalls.length = 0;
  sendCalls.length = 0;
  sendResult = { closingCents: 100, results: [{ recipientUserId: "one", status: "sent" }] };
});

describe("/admin/clients/:userId statement wrappers", () => {
  it("a client in two practices is refused with 422; nothing is built or sent", async () => {
    const pdf = await call("GET", "/admin/clients/two/statement.pdf?month=2026-10");
    expect(pdf.statusCode).toBe(422);
    expect(pdf.json().error.code).toBe("PRACTICE_REQUIRED");
    const mail = await call("POST", "/admin/clients/two/statement/email", { month: "2026-10" });
    expect(mail.statusCode).toBe(422);
    expect(pdfCalls).toHaveLength(0);
    expect(sendCalls).toHaveLength(0);
  });

  it("a client in one practice gets that practice's statement, and the email goes to that client", async () => {
    const pdf = await call("GET", "/admin/clients/one/statement.pdf?month=2026-10");
    expect(pdf.statusCode).toBe(200);
    expect(pdfCalls).toEqual([{ subject: { subject: "account", subjectId: "A1" }, month: "2026-10" }]);
    const mail = await call("POST", "/admin/clients/one/statement/email", { month: "2026-10" });
    expect(mail.statusCode).toBe(200);
    expect(mail.json()).toEqual({ data: { sent: true } });
    expect(sendCalls[0].slice(0, 2)).toEqual([{ accountId: "A1", recipientUserIds: ["one"] }, "2026-10"]);
  });

  it("a client in no practice, or one the run would not send to, reads as 404", async () => {
    expect((await call("GET", "/admin/clients/none/statement.pdf?month=2026-10")).statusCode).toBe(404);
    sendResult = { closingCents: 100, results: [] };
    expect((await call("POST", "/admin/clients/one/statement/email", { month: "2026-10" })).statusCode).toBe(404);
  });
});
