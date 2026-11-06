import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { handlerSource } from "./_source.js";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

/**
 * Review Focus 1 (piece 11): a practice's staff member opening a SIBLING
 * practice's invoice, case, pickup, thread or statement, by id or
 * `?account=`, gets 404 NOT_FOUND every time (never 403, so ids can't be
 * probed). One row per client-facing route that takes an id or an account.
 *
 * Each row is a `test.todo` until the task that moves the route onto
 * services/client-scope.js flips it to a `test` (handler-source checks as in
 * rx-doctor-view.test.js, plus service-level fakes: practice A's member, a
 * record of sibling practice B, expect NOT_FOUND). The owner task is in each
 * name; when every row is a test, delete the todo loop.
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
};

for (const { route, owner } of SIBLING_ROUTES) {
  const name = `${owner}: sibling ids read as not found: ${route}`;
  if (LIVE[route]) test(name, LIVE[route]);
  else test.todo(name);
}

test("the table covers every route Review Focus 1 names, each owned by a task", () => {
  const want = [
    "GET /invoices/:id", "GET /invoices/:id/pdf", "GET /invoices/statement.pdf?account=",
    "GET /rx/cases/:id", "GET /rx/cases/:id/files/:fileId", "GET /pickups/:id",
    "messaging thread open", "POST /payments/charge-saved",
  ];
  assert.deepEqual(SIBLING_ROUTES.map((r) => r.route).sort(), [...want].sort());
  for (const r of SIBLING_ROUTES) assert.match(r.owner, /^Task [567]$/, r.route);
  // Task 5's rows are live tests, not todos.
  for (const r of SIBLING_ROUTES.filter((x) => x.owner === "Task 5")) assert.ok(LIVE[r.route], r.route);
});
