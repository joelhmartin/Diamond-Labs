import { test } from "vitest";
import assert from "node:assert/strict";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { intakeRoutes, intakeErrorReply } from "./routes.js";
import { IntakeError } from "./rules.js";

async function build({ created = [], discarded = [], calls = [] } = {}) {
  const app = Fastify();
  app.addHook("onRequest", async (req) => { req.user = { id: "u1" }; });
  await app.register(multipart);
  await app.register(intakeRoutes, {
    staffGuard: [async () => {}],
    onCreated: (_req, intakes) => created.push(...intakes.map((i) => i.id)),
    onDiscarded: (_req, id) => discarded.push(id),
    enrich: async (rows) => rows.map((r) => ({ ...r, byName: "Sam" })),
    service: {
      createIntakes: async (args) => { calls.push(args); return { intakes: [{ id: "i1" }], refused: [{ name: "x.exe", message: "no" }] }; },
      listIntakes: async (args) => { calls.push(args); return { rows: [{ id: "i1" }], total: 1 }; },
      discardIntake: async (id) => { if (id === "gone") throw new IntakeError("CONFLICT", "Already used."); return { id }; },
    },
  });
  return app;
}

function multipartBody(parts) {
  const boundary = "----intake";
  const chunks = [];
  for (const { name, filename, value, buffer } of parts) {
    const disp = filename ? `; filename="${filename}"` : "";
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"${disp}\r\n\r\n`), buffer ?? Buffer.from(value), Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

test("a drop passes files and split to the service and reports refused files", async () => {
  const created = [];
  const calls = [];
  const app = await build({ created, calls });
  const res = await app.inject({ method: "POST", url: "/intake", ...multipartBody([
    { name: "split", value: "per_file" }, { name: "files", filename: "a.stl", buffer: Buffer.from("abc") }, { name: "files", filename: "x.exe", buffer: Buffer.from("zz") },
  ]) });
  assert.equal(res.statusCode, 201);
  assert.equal(calls[0].split, "per_file");
  assert.equal(calls[0].byUserId, "u1");
  assert.deepEqual(calls[0].files.map((f) => f.originalName), ["a.stl", "x.exe"]);
  assert.deepEqual(res.json().data.refused.map((r) => r.name), ["x.exe"]);
  assert.deepEqual(created, ["i1"]);
});

test("a drop with no files, or an unknown split, is a 422", async () => {
  const app = await build();
  const none = await app.inject({ method: "POST", url: "/intake", ...multipartBody([{ name: "split", value: "one" }]) });
  assert.equal(none.statusCode, 422);
  const bad = await app.inject({ method: "POST", url: "/intake", ...multipartBody([{ name: "split", value: "weird" }, { name: "f", filename: "a.stl", buffer: Buffer.from("a") }]) });
  assert.equal(bad.statusCode, 422);
});

test("the list is enriched; discard reports the id and calls onDiscarded; a conflict is a 409", async () => {
  const discarded = [];
  const app = await build({ discarded });
  const list = await app.inject({ method: "GET", url: "/intake?status=pending&limit=20&offset=0" });
  assert.deepEqual(list.json().data, { rows: [{ id: "i1", byName: "Sam" }], total: 1 });
  const bad = await app.inject({ method: "GET", url: "/intake?status=weird" });
  assert.equal(bad.statusCode, 422);
  const ok = await app.inject({ method: "POST", url: "/intake/i1/discard", payload: { reason: "dupe" } });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(discarded, ["i1"]);
  assert.equal((await app.inject({ method: "POST", url: "/intake/gone/discard", payload: {} })).statusCode, 409);
});

test("intake errors map to HTTP statuses; foreign errors are not swallowed", () => {
  assert.equal(intakeErrorReply(new IntakeError("NOT_FOUND", "x")).status, 404);
  assert.equal(intakeErrorReply(new IntakeError("TOO_LARGE", "x")).status, 413);
  assert.equal(intakeErrorReply(new Error("boom")), null);
});

test("a failing onCreated hook does not turn a successful drop into an error", async () => {
  const app = Fastify();
  app.addHook("onRequest", async (req) => { req.user = { id: "u1" }; });
  await app.register(multipart);
  await app.register(intakeRoutes, {
    staffGuard: [async () => {}],
    onCreated: async () => { throw new Error("notify down"); },
    service: { createIntakes: async () => ({ intakes: [{ id: "i1" }], refused: [] }) },
  });
  const orig = console.error;
  console.error = () => {};
  try {
    const res = await app.inject({ method: "POST", url: "/intake", ...multipartBody([{ name: "f", filename: "a.stl", buffer: Buffer.from("a") }]) });
    assert.equal(res.statusCode, 201);
  } finally { console.error = orig; }
});
