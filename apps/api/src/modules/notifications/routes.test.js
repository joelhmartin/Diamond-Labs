import { test, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { notificationRoutes } from "./routes.js";
import { createNotifier } from "./notifier.js";
import { defineNotificationEvent, clearEvents } from "./registry.js";
import { createFakeStore } from "./fake-store.js";

// The routes take every collaborator as an option, so a recording stand-in for
// fastify shows each registration's guards, and its handler runs on fakes.
function recordingFastify() {
  const routes = [];
  const add = (method) => (path, opts, handler) => routes.push({ method, path, opts, handler });
  return { routes, get: add("GET"), post: add("POST"), put: add("PUT"), patch: add("PATCH"), delete: add("DELETE") };
}

const authenticate = async () => {};
const requireAdmin = async () => {};
const kindOf = (user) => (user.role === "boss" || user.role === "crew" ? "staff" : "client");

function fakeReply() {
  return {
    statusCode: 200,
    body: undefined,
    code(n) { this.statusCode = n; return this; },
    send(b) { this.body = b; return this; },
  };
}

async function setup() {
  const store = createFakeStore();
  const notifier = createNotifier({ store, channels: { sms: { send: async () => ({ ok: true }) } }, random: () => 0.5 });
  const fastify = recordingFastify();
  await notificationRoutes(fastify, { notifier, authenticate, requireAdmin, kindOf, channelStatus: () => ({ sms: { ok: false } }) });
  async function call(method, path, request) {
    const r = fastify.routes.find((x) => x.method === method && x.path === path);
    assert.ok(r, `${method} ${path} is registered`);
    const reply = fakeReply();
    const out = await r.handler({ params: {}, query: {}, body: {}, ...request }, reply);
    return { status: reply.statusCode, body: reply.body ?? out };
  }
  return { store, notifier, fastify, call };
}

const staffUser = { id: "s1", role: "crew" };
const clientUser = { id: "c1", role: "member" };

beforeEach(() => {
  clearEvents();
  defineNotificationEvent({
    key: "thing.happened", label: "Thing happened", kinds: ["staff"], sms: true,
    defaults: { staff: { in_app: true, email: false } }, title: (d) => `Thing ${d.n}`,
  });
  defineNotificationEvent({
    key: "party.thing", label: "Party thing", kinds: ["client"],
    defaults: { client: { in_app: true, email: true } }, title: (d) => `Party ${d.n}`,
  });
});

test("every route is behind authenticate", async () => {
  const { fastify } = await setup();
  const paths = fastify.routes.map((r) => `${r.method} ${r.path}`);
  for (const p of [
    "GET /notifications", "GET /notifications/unread-count", "POST /notifications/read", "POST /notifications/:id/unread",
    "DELETE /notifications/:id", "GET /notifications/preferences", "PUT /notifications/preferences",
    "GET /admin/notifications/recipients", "POST /admin/notifications/recipients", "PATCH /admin/notifications/recipients/:id",
    "DELETE /admin/notifications/recipients/:id", "POST /admin/notifications/recipients/:id/test",
    "GET /admin/notifications/deliveries", "GET /admin/notifications/channels", "GET /admin/notifications/events",
  ]) assert.ok(paths.includes(p), `${p} registered`);
  for (const r of fastify.routes) {
    assert.equal(r.opts.preHandler[0], authenticate, `${r.method} ${r.path} authenticates first`);
  }
});

test("admin recipient routes require admin", async () => {
  const { fastify } = await setup();
  for (const r of fastify.routes) {
    const isAdmin = r.path.startsWith("/admin/");
    assert.equal(r.opts.preHandler.includes(requireAdmin), isAdmin, `${r.method} ${r.path}`);
  }
});

test("recipient create normalizes the phone and rejects an invalid one with 400", async () => {
  const { call, store } = await setup();
  const ok = await call("POST", "/admin/notifications/recipients", {
    user: { id: "a1", role: "boss" }, body: { event: "thing.happened", channel: "sms", address: "(512) 555-1234", label: "Front desk" },
  });
  assert.equal(ok.status, 201);
  assert.equal(store.state.recipients[0].address, "+15125551234");
  assert.equal(store.state.recipients[0].createdByUserId, "a1");
  assert.equal(ok.body.data.address, "•••1234", "the number goes back masked");

  const bad = await call("POST", "/admin/notifications/recipients", {
    user: { id: "a1", role: "boss" }, body: { event: "thing.happened", channel: "sms", address: "555-12" },
  });
  assert.equal(bad.status, 400);
  assert.equal(store.state.recipients.length, 1);

  const dup = await call("POST", "/admin/notifications/recipients", {
    user: { id: "a1", role: "boss" }, body: { event: "thing.happened", channel: "sms", address: "512-555-1234" },
  });
  assert.equal(dup.status, 409);

  const unknown = await call("POST", "/admin/notifications/recipients", {
    user: { id: "a1", role: "boss" }, body: { event: "nope.never", channel: "sms", address: "512-555-9999" },
  });
  assert.equal(unknown.status, 400);

  const schema = await call("POST", "/admin/notifications/recipients", { user: { id: "a1", role: "boss" }, body: { event: "thing.happened", channel: "fax", address: "x" } });
  assert.equal(schema.status, 422);
});

test("preferences PUT refuses an event not visible to the user's kind", async () => {
  const { call, store } = await setup();
  const refused = await call("PUT", "/notifications/preferences", { user: clientUser, body: { event: "thing.happened", channel: "in_app", enabled: false } });
  assert.equal(refused.status, 400);
  assert.equal(store.state.preferences.length, 0);

  const saved = await call("PUT", "/notifications/preferences", { user: clientUser, body: { event: "party.thing", channel: "email", enabled: false } });
  assert.equal(saved.status, 200);
  assert.deepEqual(store.state.preferences.map(({ userId, event, channel, enabled }) => ({ userId, event, channel, enabled })),
    [{ userId: "c1", event: "party.thing", channel: "email", enabled: false }]);

  const prefs = await call("GET", "/notifications/preferences", { user: clientUser });
  assert.deepEqual(prefs.body.data, [{ event: "party.thing", label: "Party thing", channels: { in_app: true, email: false } }]);
  const staffPrefs = await call("GET", "/notifications/preferences", { user: staffUser });
  assert.deepEqual(staffPrefs.body.data.map((p) => p.event), ["thing.happened"]);
});

test("a user's list, count, read, unread and dismiss touch only their own rows", async () => {
  // Seed through a notifier whose audience resolver knows the user ids it is given.
  const st = createFakeStore();
  const n = createNotifier({
    store: st, random: () => 0.5,
    resolveAudience: async (_db, a) => (a.userIds ?? []).map((id) => ({ id, email: null, kind: id.startsWith("s") ? "staff" : "client" })),
  });
  await n.notify(null, { event: "thing.happened", recordType: "w", recordId: "1", audience: { userIds: ["s1", "s2"] }, data: { n: 1 } });
  await n.notify(null, { event: "thing.happened", recordType: "w", recordId: "2", audience: { userIds: ["s1"] }, data: { n: 2 } });
  const fastify = recordingFastify();
  await notificationRoutes(fastify, { notifier: n, authenticate, requireAdmin, kindOf });
  const run = async (method, path, request) => {
    const reply = fakeReply();
    const out = await fastify.routes.find((x) => x.method === method && x.path === path).handler({ params: {}, query: {}, body: {}, ...request }, reply);
    return { status: reply.statusCode, body: reply.body ?? out };
  };
  const list = await run("GET", "/notifications", { user: staffUser, query: { unread: "true", limit: "10" } });
  assert.equal(list.body.data.total, 2);
  assert.deepEqual(list.body.data.rows.map((r) => r.title).sort(), ["Thing 1", "Thing 2"]);
  assert.equal((await run("GET", "/notifications/unread-count", { user: staffUser })).body.data.count, 2);

  const otherId = st.state.notifications.find((r) => r.userId === "s2").id;
  assert.equal((await run("DELETE", "/notifications/:id", { user: staffUser, params: { id: otherId } })).status, 404);
  assert.equal((await run("POST", "/notifications/read", { user: staffUser, body: { ids: [] } })).status, 422);
  assert.equal((await run("POST", "/notifications/read", { user: staffUser, body: { all: true } })).body.data.updated, 2);
  assert.equal((await run("GET", "/notifications/unread-count", { user: { id: "s2", role: "crew" } })).body.data.count, 1);
  const mine = st.state.notifications.find((r) => r.userId === "s1").id;
  assert.equal((await run("POST", "/notifications/:id/unread", { user: staffUser, params: { id: mine } })).status, 200);
  assert.equal((await run("DELETE", "/notifications/:id", { user: staffUser, params: { id: mine } })).status, 200);
});

test("channels status comes from the injected reporter; deliveries filter by channel and status", async () => {
  const { call, notifier } = await setup();
  assert.deepEqual((await call("GET", "/admin/notifications/channels", { user: { id: "a1", role: "boss" } })).body.data, { sms: { ok: false } });
  const added = await notifier.recipients.add(null, { event: "thing.happened", channel: "sms", address: "+15125550000" });
  await notifier.recipients.sendTest(null, added.id);
  const all = await call("GET", "/admin/notifications/deliveries", { user: { id: "a1", role: "boss" }, query: {} });
  assert.equal(all.body.data.rows.length, 1);
  const failed = await call("GET", "/admin/notifications/deliveries", { user: { id: "a1", role: "boss" }, query: { status: "failed" } });
  assert.equal(failed.body.data.rows.length, 0);
  const sms = await call("GET", "/admin/notifications/deliveries", { user: { id: "a1", role: "boss" }, query: { channel: "sms", status: "sent" } });
  assert.equal(sms.body.data.rows.length, 1);
  assert.equal(all.body.data.total, 1);
  assert.equal(failed.body.data.total, 0);
  const bad = await call("GET", "/admin/notifications/deliveries", { user: { id: "a1", role: "boss" }, query: { status: "lost" } });
  assert.equal(bad.status, 422);
});

test("admin events lists every registered event with its sms flag", async () => {
  const { call } = await setup();
  const res = await call("GET", "/admin/notifications/events", { user: { id: "a1", role: "boss" } });
  assert.equal(res.status, 200);
  assert.ok(res.body.data.length > 0);
  for (const e of res.body.data) assert.deepEqual(Object.keys(e).sort(), ["key", "label", "sms"]);
  assert.ok(res.body.data.some((e) => e.key === "thing.happened"));
});
