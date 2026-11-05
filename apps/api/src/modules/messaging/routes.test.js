import { test } from "vitest";
import assert from "node:assert/strict";

process.env.PHI_ENCRYPTION_KEY ||= "a".repeat(64);

const { messagingRoutes } = await import("./routes.js");
const { createMessaging } = await import("./messaging.service.js");
const { createFakeStore } = await import("./fake-store.js");

// The routes take every collaborator as an option, so a recording stand-in for
// fastify shows each registration's guards, and its handler runs on fakes.
function recordingFastify() {
  const routes = [];
  const add = (method) => (path, opts, handler) => routes.push({ method, path, opts, handler });
  return { routes, get: add("GET"), post: add("POST"), put: add("PUT"), patch: add("PATCH"), delete: add("DELETE") };
}

function fakeReply() {
  return {
    statusCode: 200,
    body: undefined,
    code(n) { this.statusCode = n; return this; },
    send(b) { this.body = b; return this; },
  };
}

const authenticate = async () => {};
const guard = async () => {};
const host = { id: "h1", role: "staff" };
const party = { id: "p1", role: "member", org: "1" };
const other = { id: "p2", role: "member", org: "2" };

async function setup(opts = {}) {
  const db = { transaction: async (fn) => fn(db) };
  const messaging = createMessaging({
    db, store: createFakeStore(),
    isHost: (u) => u.role === "staff",
    partyKeysFor: (u) => [`user:${u.id}`, ...(u.org ? [`org:${u.org}`] : [])],
    defaultPartyKey: (u) => `org:${u.org}`,
    log: { error() {}, warn() {} },
  });
  const fastify = recordingFastify();
  await messagingRoutes(fastify, { messaging, authenticate, ...opts });
  async function call(method, path, request) {
    const r = fastify.routes.find((x) => x.method === method && x.path === path);
    assert.ok(r, `${method} ${path} is registered`);
    const reply = fakeReply();
    const out = await r.handler({ params: {}, query: {}, body: {}, ...request }, reply);
    return { status: reply.statusCode, body: reply.body ?? out };
  }
  return { fastify, call, messaging };
}

const ALL = [
  "GET /messages/threads", "GET /messages/unread-count", "POST /messages/threads", "GET /messages/threads/:id",
  "POST /messages/threads/:id/messages", "POST /messages/threads/:id/read", "POST /messages/threads/:id/unread",
  "POST /messages/threads/:id/complete", "POST /messages/threads/:id/reopen",
  "POST /messages/threads/:id/archive", "POST /messages/threads/:id/unarchive",
];

test("every route uses authenticate", async () => {
  const { fastify } = await setup();
  const paths = fastify.routes.map((r) => `${r.method} ${r.path}`);
  for (const p of ALL) assert.ok(paths.includes(p), `${p} registered`);
  assert.ok(!paths.includes("GET /messages/parties"), "parties only exist when the host app supplies listParties");
  for (const r of fastify.routes) assert.deepEqual(r.opts.preHandler, [authenticate], `${r.method} ${r.path}`);
});

test("a guard runs after authenticate on every route, parties included", async () => {
  const { fastify } = await setup({ guard, listParties: async () => [] });
  assert.ok(fastify.routes.some((r) => r.path === "/messages/parties"));
  for (const r of fastify.routes) assert.deepEqual(r.opts.preHandler, [authenticate, guard], `${r.method} ${r.path}`);
});

test("create takes JSON, answers 201, and validation failures are 422", async () => {
  const { call } = await setup();
  const ok = await call("POST", "/messages/threads", { user: party, body: { subject: "Hi", body: "Hello" } });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.data.subject, "Hi");
  assert.equal(ok.body.data.partyKey, "org:1");
  const bad = await call("POST", "/messages/threads", { user: party, body: { body: "" } });
  assert.equal(bad.status, 422);
  assert.equal(bad.body.error.code, "VALIDATION_ERROR");
});

test("service errors map: NOT_FOUND → 404, FORBIDDEN → 403, INVALID → 400", async () => {
  const { call } = await setup();
  const t = (await call("POST", "/messages/threads", { user: party, body: { body: "Hello" } })).body.data;
  const hidden = await call("GET", "/messages/threads/:id", { user: other, params: { id: t.id } });
  assert.equal(hidden.status, 404);
  assert.equal(hidden.body.error.code, "NOT_FOUND");
  const forbidden = await call("POST", "/messages/threads/:id/complete", { user: party, params: { id: t.id } });
  assert.equal(forbidden.status, 403);
  const invalid = await call("POST", "/messages/threads", { user: host, body: { body: "no party" } });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, "INVALID");
  const badFolder = await call("GET", "/messages/threads", { user: party, query: { folder: "completed" } });
  assert.equal(badFolder.status, 400);
});

test("post, open, read state, list and unread count round-trip", async () => {
  const { call } = await setup();
  const t = (await call("POST", "/messages/threads", { user: party, body: { body: "Hello" } })).body.data;
  assert.equal((await call("GET", "/messages/unread-count", { user: host })).body.data.count, 1);
  const posted = await call("POST", "/messages/threads/:id/messages", { user: host, params: { id: t.id }, body: { body: "Reply" } });
  assert.equal(posted.status, 201);
  assert.equal(posted.body.data.body, "Reply");
  const opened = await call("GET", "/messages/threads/:id", { user: party, params: { id: t.id } });
  assert.equal(opened.body.data.messages.length, 2);
  await call("POST", "/messages/threads/:id/unread", { user: party, params: { id: t.id } });
  assert.equal((await call("GET", "/messages/unread-count", { user: party })).body.data.count, 1);
  await call("POST", "/messages/threads/:id/read", { user: party, params: { id: t.id } });
  assert.equal((await call("GET", "/messages/unread-count", { user: party })).body.data.count, 0);
  await call("POST", "/messages/threads/:id/archive", { user: party, params: { id: t.id } });
  assert.equal((await call("GET", "/messages/threads", { user: party, query: { folder: "archived" } })).body.data.total, 1);
  await call("POST", "/messages/threads/:id/unarchive", { user: party, params: { id: t.id } });
  const list = await call("GET", "/messages/threads", { user: party, query: { limit: "10" } });
  assert.equal(list.body.data.total, 1);
});

test("parties are host only and pass the query through", async () => {
  const seen = [];
  const { call } = await setup({ listParties: async (_db, q) => { seen.push(q); return [{ key: "org:1", label: "Acme" }]; } });
  const ok = await call("GET", "/messages/parties", { user: host, query: { q: "ac" } });
  assert.deepEqual(ok.body.data, [{ key: "org:1", label: "Acme" }]);
  assert.deepEqual(seen, ["ac"]);
  const no = await call("GET", "/messages/parties", { user: party, query: {} });
  assert.equal(no.status, 403);
});
