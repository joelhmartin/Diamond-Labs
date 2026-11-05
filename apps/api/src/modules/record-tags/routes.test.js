import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { handlerSource } from "../../routes/__tests__/_source.js";
import { recordTagRoutes, tagErrorReply } from "./routes.js";
import { TagError } from "./rules.js";

const source = readFileSync(fileURLToPath(new URL("./routes.js", import.meta.url)), "utf8");

test("definition management uses adminGuard; read, apply and star use staffGuard", () => {
  for (const marker of ['fastify.post("/admin/tags/:recordType/definitions",', 'fastify.patch("/admin/tags/:recordType/definitions/:id",']) {
    const body = handlerSource(source, marker);
    assert.match(body, /\.\.\.admin/, marker);
    assert.doesNotMatch(body, /\.\.\.staff/, marker);
  }
  for (const marker of [
    'fastify.get("/tags/:recordType/definitions",', 'fastify.post("/tags/:recordType/apply",',
    'fastify.put("/tags/:recordType/:recordId/star",', 'fastify.delete("/tags/:recordType/:recordId/star",',
  ]) {
    const body = handlerSource(source, marker);
    assert.match(body, /\.\.\.staff/, marker);
    assert.doesNotMatch(body, /\.\.\.admin/, marker);
  }
});

test("tag errors map to HTTP statuses; foreign errors are not swallowed", () => {
  assert.equal(tagErrorReply(new TagError("NOT_FOUND", "x")).status, 404);
  assert.equal(tagErrorReply(new TagError("CONFLICT", "x")).status, 409);
  assert.equal(tagErrorReply(new TagError("INVALID", "x")).status, 422);
  assert.equal(tagErrorReply(new Error("boom")), null);
});

async function build(service) {
  const app = Fastify();
  const pass = async () => {};
  app.addHook("onRequest", async (req) => { req.user = { id: "u1" }; });
  await app.register(recordTagRoutes, {
    recordTypes: { widget: { exists: async (ids) => new Set(ids), onChange: async () => {} } },
    staffGuard: [pass], adminGuard: [pass], service,
  });
  return app;
}

test("an unknown :recordType is a 404 on every route group", async () => {
  const app = await build({});
  for (const [method, url, payload] of [
    ["GET", "/tags/nope/definitions"],
    ["POST", "/admin/tags/nope/definitions", { label: "x" }],
    ["PATCH", "/admin/tags/nope/definitions/abc", { label: "x" }],
    ["POST", "/tags/nope/apply", { ids: ["a"], add: ["t"] }],
    ["PUT", "/tags/nope/r1/star"],
    ["DELETE", "/tags/nope/r1/star"],
  ]) {
    const res = await app.inject({ method, url, payload });
    assert.equal(res.statusCode, 404, `${method} ${url}`);
  }
  await app.close();
});

test("PATCH passes the URL record type to the service so a wrong type is refused before any write", async () => {
  const seen = [];
  const app = await build({
    updateDefinition: async (id, patch, type) => {
      seen.push(type);
      if (type !== "widget") throw new TagError("NOT_FOUND", "Tag not found.");
      return { id, recordType: type, ...patch };
    },
  });
  const ok = await app.inject({ method: "PATCH", url: "/admin/tags/widget/definitions/t1", payload: { label: "x" } });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(seen, ["widget"]);
  await app.close();
});

test("updateDefinition refuses a tag of another type without writing", async () => {
  const { updateDefinition } = await import("./service.js");
  let wrote = false;
  const fakeDb = {
    select: () => ({ from: () => ({ where: async () => [{ id: "t1", recordType: "other", label: "A" }] }) }),
    update: () => { wrote = true; },
  };
  await assert.rejects(() => updateDefinition("t1", { label: "B" }, "widget", fakeDb), (e) => e.code === "NOT_FOUND");
  assert.equal(wrote, false);
});

test("a known type reaches the service and TagError maps to its status", async () => {
  const calls = [];
  const app = await build({
    listDefinitions: async (type, opts) => { calls.push([type, opts]); return []; },
    applyTags: async () => { throw new TagError("INVALID", "Unknown tag."); },
    setStar: async (a) => ({ starred: a.starred }),
  });
  const list = await app.inject({ method: "GET", url: "/tags/widget/definitions?includeInactive=true" });
  assert.equal(list.statusCode, 200);
  assert.deepEqual(calls[0], ["widget", { includeInactive: true }]);
  const apply = await app.inject({ method: "POST", url: "/tags/widget/apply", payload: { ids: ["a"], add: ["t"] } });
  assert.equal(apply.statusCode, 422);
  const star = await app.inject({ method: "PUT", url: "/tags/widget/r1/star" });
  assert.deepEqual(star.json().data, { starred: true });
  const empty = await app.inject({ method: "POST", url: "/tags/widget/apply", payload: { ids: ["a"] } });
  assert.equal(empty.statusCode, 422);
  await app.close();
});
