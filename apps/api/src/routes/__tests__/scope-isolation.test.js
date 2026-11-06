import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { handlerSource } from "./_source.js";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";
process.env.PHI_ENCRYPTION_KEY ||= "a".repeat(64);

/**
 * Review Focus 1 (piece 11): a practice's staff member opening a SIBLING
 * practice's invoice, case, pickup, thread or statement, by id or
 * `?account=`, gets 404 NOT_FOUND every time (never 403, so ids can't be
 * probed). One row per client-facing route that takes an id or an account.
 *
 * Each row is a live test (handler-source checks as in rx-doctor-view.test.js,
 * plus service-level fakes: practice A's member, a record of sibling practice
 * B, expect NOT_FOUND). The task that moved the route onto
 * services/client-scope.js is in each name.
 */
const SIBLING_ROUTES = [
  { route: "GET /invoices/:id", owner: "Task 5" },
  { route: "GET /invoices/:id/pdf", owner: "Task 5" },
  { route: "POST /payments/charge-saved", owner: "Task 5" },
  { route: "GET /invoices/statement.pdf?account=", owner: "Task 7" },
  { route: "GET /rx/cases/:id", owner: "Task 6" },
  { route: "GET /rx/cases/:id/files/:fileId", owner: "Task 6" },
  { route: "GET /pickups/:id", owner: "Task 6" },
  { route: "messaging thread open", owner: "Task 6" },
];

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const { toClientScope } = await import("../../services/client-scope-rules.js");
const scopeOf = (roles) => toClientScope({ accountIds: Object.keys(roles), roles: new Map(Object.entries(roles)), via: new Map(), organizations: [] });
// Practice A's member; the record belongs to sibling practice B (same group, not this login's).
const memberOfA = { id: "staffA", role: "user", scope: scopeOf({ A: "member" }) };
// A stand-in db whose one select answers `row` (a case row, as loadClientCase reads it).
const rowDb = (row) => ({ select: () => ({ from: () => ({ where: async () => (row ? [row] : []) }) }) });
const siblingInvoice = { invoice: { id: "inv-b", accountId: "B", status: "issued", clientUserId: "docB" } };

const LIVE = {
  "GET /invoices/:id": async () => {
    const { clientMayRead } = await import("../invoice.routes.js");
    assert.equal(clientMayRead(memberOfA, siblingInvoice), false);
    assert.equal(clientMayRead(memberOfA, { invoice: { ...siblingInvoice.invoice, accountId: "A" } }), true, "the probe is sound");
    const src = read("../invoice.routes.js");
    assert.match(handlerSource(src, 'fastify.get("/invoices/:id",'), /preHandler: CLIENT_PORTAL[\s\S]*invoiceDetailHandler\(\{ mayRead: clientMayRead, view: doctorInvoiceView \}\)/);
    // A false mayRead answers 404 NOT_FOUND in the one shared loader (never 403).
    assert.match(read("../invoice-detail.handler.js"), /if \(!detail \|\| !mayRead\(request\.user, detail\)\) \{\s*reply\.code\(404\)\.send\(\{ error: ERROR_CODES\.NOT_FOUND \}\)/);
  },
  "GET /invoices/:id/pdf": async () => {
    const { clientMayRead } = await import("../invoice.routes.js");
    assert.equal(clientMayRead(memberOfA, siblingInvoice), false);
    assert.match(handlerSource(read("../invoice.routes.js"), 'fastify.get("/invoices/:id/pdf",'), /preHandler: CLIENT_PORTAL[\s\S]*invoicePdfHandler\(\{ mayRead: clientMayRead \}\)/);
  },
  "POST /payments/charge-saved": async () => {
    const { verifyAllocations } = await import("../../services/payment-recording.service.js");
    const { sendAllocationError } = await import("../payment-replies.js");
    const { fakeTx } = await import("../../test/fake-tx.js");
    const database = fakeTx({ selects: [[{ id: "inv-b", invoiceNumber: 500002, accountId: "B", accountNumber: null, status: "issued", totalCents: 1000 }]] });
    const refused = await verifyAllocations([{ invoiceId: "inv-b", amountCents: 100 }], memberOfA.scope, { database });
    const reply = { code(c) { this.status = c; return this; }, send(b) { this.body = b; return this; } };
    sendAllocationError(reply, refused);
    assert.equal(reply.status, 404);
    assert.equal(reply.body.error.code, "NOT_FOUND");
    const src = read("../invoice-payment.routes.js");
    assert.match(src, /const own = await verifyAllocations\(allocations, clientScopeOf\(request\.user\)\);\s*if \(own\) return sendAllocationError\(reply, own\);/);
  },
  "GET /invoices/statement.pdf?account=": async () => {
    const { requestedStatementSubject } = await import("../../services/client-scope.js");
    const notFound = (e) => e.statusCode === 404 && e.code === "NOT_FOUND";
    assert.throws(() => requestedStatementSubject(memberOfA.scope, "B"), notFound, "a sibling practice");
    assert.throws(() => requestedStatementSubject(memberOfA.scope, "organization:g1"), notFound, "a group this login does not administer");
    assert.deepEqual(requestedStatementSubject(memberOfA.scope, "A"), { subject: "account", subjectId: "A" }, "the probe is sound");
    const body = handlerSource(read("../invoice.routes.js"), 'fastify.get("/invoices/statement.pdf",');
    assert.match(body, /preHandler: \[\.\.\.CLIENT_PORTAL, validateQuery\(statementDownloadQuerySchema\)\]/);
    assert.match(body, /statementPdfHandler\(\{\s*subject: \(request\) => requestedStatementSubject\(clientScopeOf\(request\.user\), request\.query\.account\),/);
    // The subject is chosen before anything loads: a thrown 404 reaches the error handler as is (statusCode + code).
    const handler = read("../invoice-detail.handler.js");
    assert.match(handler, /const s = await subject\(request\);\s*let out;\s*try \{/);
    assert.match(read("../../middleware/error-handler.js"), /if \(error\.statusCode && error\.code\)/);
  },
  "GET /rx/cases/:id": async () => {
    const { loadClientCase } = await import("../../services/rx/client-cases.js");
    const database = rowDb({ id: "c-b", accountId: "B", userId: "docB" });
    assert.equal(await loadClientCase(memberOfA, "c-b", { database }), null);
    assert.ok(await loadClientCase(memberOfA, "c-a", { database: rowDb({ id: "c-a", accountId: "A", userId: "docA" }) }), "the probe is sound");
    const body = handlerSource(read("../rx.routes.js"), 'fastify.get("/rx/cases/:id",');
    assert.match(body, /preHandler: \[authenticate, requireClientPortal\]/);
    assert.match(body, /const caseRow = await loadClientCase\(request\.user, request\.params\.id\);\s*if \(!caseRow\) \{\s*return reply\.code\(404\)\.send\(\{ error: ERROR_CODES\.NOT_FOUND \}\);/);
  },
  "GET /rx/cases/:id/files/:fileId": async () => {
    const { loadClientCase } = await import("../../services/rx/client-cases.js");
    assert.equal(await loadClientCase(memberOfA, "c-b", { database: rowDb({ id: "c-b", accountId: "B", userId: "docB" }) }), null);
    const body = handlerSource(read("../rx.routes.js"), 'fastify.get("/rx/cases/:id/files/:fileId",');
    assert.match(body, /preHandler: \[authenticate, requireClientPortal\]/);
    assert.match(body, /const caseRow = await loadClientCase\(request\.user, request\.params\.id\);\s*if \(!caseRow\) \{\s*return reply\.code\(404\)\.send\(\{ error: ERROR_CODES\.NOT_FOUND \}\);/);
    // The file must also belong to that case.
    assert.match(body, /eq\(rxCaseFiles\.caseId, caseRow\.id\)/);
  },
  "GET /pickups/:id": async () => {
    const { getPickup } = await import("../../services/lab/pickups.service.js");
    const { drizzle } = await import("drizzle-orm/pg-proxy");
    const calls = [];
    const database = drizzle(async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; });
    await assert.rejects(getPickup("pk-b", memberOfA, { database }), (e) => e.code === "NOT_FOUND");
    // Only A's keys are asked for, so B's pickup can never match.
    assert.deepEqual(calls[0].params.slice(0, 3), ["user:staffA", "practice:A", "pk-b"]);
    const { labRouteErrorReply } = await import("../lab-route-helpers.js");
    const { PickupError } = await import("../../services/lab/pickup-rules.js");
    assert.equal(labRouteErrorReply(new PickupError("NOT_FOUND", "Pickup not found.")).status, 404);
    assert.match(handlerSource(read("../pickups.routes.js"), 'fastify.get("/pickups/:id",'), /preHandler: \[authenticate, requireClientPortal\]/);
  },
  "messaging thread open": async () => {
    const { createLabMessaging } = await import("../../services/lab/lab-messaging.js");
    const { createFakeStore } = await import("../../modules/messaging/index.js");
    const db = { transaction: async (fn) => fn(db), select: () => { throw new Error("no db"); } };
    const messaging = createLabMessaging({
      db, labName: "L", log: { error() {}, warn() {} }, notify: async () => {},
      overrides: { store: createFakeStore(), describeParty: async () => new Map(), describeUsers: async () => new Map() },
    });
    const t = await messaging.createThread({ id: "s1", role: "lab" }, { party: "practice:B", body: "Hello" });
    await assert.rejects(messaging.getThread(memberOfA, t.id), (e) => e.code === "NOT_FOUND");
    assert.equal((await messaging.getThread({ id: "mB", role: "user", scope: scopeOf({ B: "member" }) }, t.id)).messages.length, 1, "the probe is sound");
    // The module's routes answer NOT_FOUND as 404 (never 403).
    assert.match(read("../../modules/messaging/routes.js"), /const STATUS = \{ NOT_FOUND: 404,/);
  },
};

for (const { route, owner } of SIBLING_ROUTES) test(`${owner}: sibling ids read as not found: ${route}`, LIVE[route]);

test("the table covers every route Review Focus 1 names, each owned by a task", () => {
  const want = [
    "GET /invoices/:id", "GET /invoices/:id/pdf", "GET /invoices/statement.pdf?account=",
    "GET /rx/cases/:id", "GET /rx/cases/:id/files/:fileId", "GET /pickups/:id",
    "messaging thread open", "POST /payments/charge-saved",
  ];
  assert.deepEqual(SIBLING_ROUTES.map((r) => r.route).sort(), [...want].sort());
  for (const r of SIBLING_ROUTES) assert.match(r.owner, /^Task [567]$/, r.route);
  // Every row is a live test, not a todo.
  for (const r of SIBLING_ROUTES) assert.ok(LIVE[r.route], r.route);
});
