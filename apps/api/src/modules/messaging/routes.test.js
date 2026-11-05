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
    redirect(url, code = 302) { this.statusCode = code; this.location = url; return this; },
  };
}

const authenticate = async () => {};
const guard = async () => {};
const host = { id: "h1", role: "staff" };
const party = { id: "p1", role: "member", org: "1" };
const other = { id: "p2", role: "member", org: "2" };

async function setup({ files = null, ...opts } = {}) {
  const db = { transaction: async (fn) => fn(db) };
  const messaging = createMessaging({
    db, store: createFakeStore(), files,
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
    return { status: reply.statusCode, body: reply.body ?? out, location: reply.location };
  }
  return { fastify, call, messaging };
}

const ALL = [
  "GET /messages/threads", "GET /messages/unread-count", "POST /messages/threads", "GET /messages/threads/:id",
  "POST /messages/threads/:id/messages", "POST /messages/threads/:id/read", "POST /messages/threads/:id/unread",
  "POST /messages/threads/:id/complete", "POST /messages/threads/:id/reopen",
  "POST /messages/threads/:id/archive", "POST /messages/threads/:id/unarchive",
  "GET /messages/attachments/:id",
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

// ── Attachments ─────────────────────────────────────────────────────────────

function memoryFiles() {
  const f = { rows: [], signed: [] };
  f.attach = async (_db, { recordId, files }) => files.map((x) => {
    const r = { id: `f${f.rows.length + 1}`, recordId, fileName: x.originalName, contentType: x.contentType, sizeBytes: x.buffer.length };
    f.rows.push(r);
    return r;
  });
  f.listFor = async (_db, ids) => new Map(ids.map((id) => [id, f.rows.filter((r) => r.recordId === id)]).filter(([, v]) => v.length));
  f.find = async (_db, id) => { const r = f.rows.find((x) => x.id === id); return r ? { id: r.id, messageId: r.recordId } : null; };
  f.signedUrl = async (_db, id) => { f.signed.push(id); return `https://signed.example/${id}`; };
  f.remove = async () => {};
  return f;
}

// A multipart request as @fastify/multipart presents it: an async iterator of
// field and file parts. `drained` lists file parts whose stream was consumed.
function multipart(parts) {
  const drained = [];
  const request = {
    isMultipart: () => true,
    body: undefined,
    async *parts() {
      for (const p of parts) {
        if (p.file) {
          yield {
            type: "file", fieldname: p.field, filename: p.file, mimetype: "application/pdf",
            toBuffer: async () => { drained.push(p.field); return Buffer.from(p.content ?? "abc"); },
          };
        } else yield { type: "field", fieldname: p.field, value: p.value };
      }
    },
  };
  return { request, drained };
}
const file = (name, field = "files") => ({ field, file: name });

test("multipart post drains unknown parts and rejects a 6th file", async () => {
  const files = memoryFiles();
  const { call } = await setup({ files });
  const t = (await call("POST", "/messages/threads", { user: party, body: { body: "Hello" } })).body.data;

  const ok = multipart([{ field: "body", value: "See scan" }, file("a.pdf"), file("junk.bin", "other"), file("b.pdf")]);
  const posted = await call("POST", "/messages/threads/:id/messages", { ...ok.request, user: party, params: { id: t.id } });
  assert.equal(posted.status, 201);
  assert.equal(posted.body.data.body, "See scan");
  assert.deepEqual(posted.body.data.attachments.map((a) => a.fileName), ["a.pdf", "b.pdf"]);
  assert.ok(ok.drained.includes("other"), "an unknown file part is drained, not attached");

  const six = multipart([{ field: "body", value: "Too many" }, ...Array.from({ length: 6 }, (_, i) => file(`${i}.pdf`))]);
  const refused = await call("POST", "/messages/threads/:id/messages", { ...six.request, user: party, params: { id: t.id } });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error.code, "INVALID");
  assert.equal(files.rows.length, 2, "nothing from the refused post was stored");
});

test("multipart create takes fields and files; a bad field is 422", async () => {
  const files = memoryFiles();
  const { call } = await setup({ files });
  const form = multipart([{ field: "subject", value: "Fit" }, { field: "body", value: "Hello" }, file("a.pdf")]);
  const made = await call("POST", "/messages/threads", { ...form.request, user: party });
  assert.equal(made.status, 201);
  assert.equal(made.body.data.subject, "Fit");
  assert.equal(files.rows.length, 1);
  const bad = multipart([{ field: "body", value: "" }]);
  assert.equal((await call("POST", "/messages/threads", { ...bad.request, user: party })).status, 422);
});

test("JSON body is still accepted when no files", async () => {
  const { call } = await setup({ files: memoryFiles() });
  const t = await call("POST", "/messages/threads", { user: party, isMultipart: () => false, body: { body: "Plain" } });
  assert.equal(t.status, 201);
  const p = await call("POST", "/messages/threads/:id/messages", { user: party, isMultipart: () => false, params: { id: t.body.data.id }, body: { body: "Also plain" } });
  assert.equal(p.status, 201);
  assert.deepEqual(p.body.data.attachments, []);
});

test("attachment download: 302 to the signed link, ?as=json for the browser app, 404 without access", async () => {
  const files = memoryFiles();
  const reads = [];
  const { call } = await setup({ files, onAttachmentRead: (_req, info) => reads.push(info) });
  const form = multipart([{ field: "body", value: "Hello" }, file("a.pdf")]);
  const t = (await call("POST", "/messages/threads", { ...form.request, user: party })).body.data;
  const reply = await call("GET", "/messages/attachments/:id", { user: host, params: { id: "f1" } });
  assert.equal(reply.status, 302);
  assert.equal(reply.location, "https://signed.example/f1");
  const json = await call("GET", "/messages/attachments/:id", { user: party, params: { id: "f1" }, query: { as: "json" } });
  assert.deepEqual(json.body, { data: { url: "https://signed.example/f1" } });
  assert.deepEqual(reads, [{ fileId: "f1", threadId: t.id }, { fileId: "f1", threadId: t.id }]);

  const hidden = await call("GET", "/messages/attachments/:id", { user: other, params: { id: "f1" } });
  assert.equal(hidden.status, 404);
  assert.equal(hidden.body.error.code, "NOT_FOUND");
  assert.deepEqual(files.signed, ["f1", "f1"], "no link is signed for someone who cannot read the thread");
});
