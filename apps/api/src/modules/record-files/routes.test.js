import { test } from "vitest";
import assert from "node:assert/strict";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { recordFileRoutes, fileErrorReply } from "./routes.js";
import { FileError } from "./service.js";
import { MAX_FILE_SIZE_BYTES, RECORD_FILES_MAX_COUNT } from "@my-app/shared";

const file = { id: "f1", recordType: "widget", recordId: "w1", kind: "scan", originalName: "a.stl", size: 3 };

async function build({ reads = [] } = {}) {
  const app = Fastify();
  app.addHook("onRequest", async (req) => { req.user = { id: "u1" }; });
  const service = {
    filesFor: async () => new Map([["w1", [file]]]),
    getFile: async (id) => { if (id !== "f1") throw new FileError("NOT_FOUND", "File not found."); return file; },
    signedUrlFor: async () => ({ url: "https://signed", file }),
    removeFile: async () => file,
  };
  await app.register(recordFileRoutes, {
    recordTypes: { widget: { exists: async (ids) => new Set(ids.filter((i) => i === "w1")) } },
    staffGuard: [async () => {}],
    onRead: (req, f) => reads.push(f.id),
    service,
  });
  return app;
}

test("an unknown recordType or a missing record is a 404 on every route", async () => {
  const app = await build();
  for (const [method, url] of [
    ["GET", "/files/nope/w1"], ["POST", "/files/nope/w1"], ["GET", "/files/nope/w1/f1/url"], ["DELETE", "/files/nope/w1/f1"],
    ["GET", "/files/widget/missing"], ["POST", "/files/widget/missing"], ["GET", "/files/widget/missing/f1/url"], ["DELETE", "/files/widget/missing/f1"],
  ]) {
    assert.equal((await app.inject({ method, url })).statusCode, 404, `${method} ${url}`);
  }
});

test("lists files; the signed link is audited through onRead; a file of another record is a 404", async () => {
  const reads = [];
  const app = await build({ reads });
  const list = await app.inject({ method: "GET", url: "/files/widget/w1" });
  assert.deepEqual(list.json().data, [file]);
  const ok = await app.inject({ method: "GET", url: "/files/widget/w1/f1/url" });
  assert.equal(ok.json().data.url, "https://signed");
  assert.deepEqual(reads, ["f1"]);
  // f1 belongs to w1, so asking for it under a different record must not resolve.
  const app2 = Fastify();
  await app2.register(recordFileRoutes, {
    recordTypes: { widget: { exists: async (ids) => new Set(ids) } },
    staffGuard: [async () => {}],
    service: { getFile: async () => file, signedUrlFor: async () => { throw new Error("must not sign"); } },
  });
  assert.equal((await app2.inject({ method: "GET", url: "/files/widget/w2/f1/url" })).statusCode, 404);
});

test("file errors map to HTTP statuses; foreign errors are not swallowed", () => {
  assert.equal(fileErrorReply(new FileError("NOT_FOUND", "x")).status, 404);
  assert.equal(fileErrorReply(new FileError("TOO_LARGE", "x")).status, 413);
  assert.equal(fileErrorReply(new FileError("INVALID", "x")).status, 422);
  assert.equal(fileErrorReply(new Error("boom")), null);
});

// ---- multipart upload -------------------------------------------------------

async function buildUpload(attached) {
  const app = Fastify();
  app.addHook("onRequest", async (req) => { req.user = { id: "u1" }; });
  await app.register(multipart);
  await app.register(recordFileRoutes, {
    recordTypes: { widget: { exists: async (ids) => new Set(ids) } },
    staffGuard: [async () => {}],
    service: { attachFiles: async (args) => { attached.push(args); return args.files.map((f, i) => ({ id: `n${i}`, kind: f.kind })); } },
  });
  return app;
}

function multipartBody(parts) {
  const boundary = "----recfiles";
  const chunks = [];
  for (const { name, filename, buffer } of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`), buffer, Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

test("multipart upload: files are attached under their field-name kind", async () => {
  const attached = [];
  const app = await buildUpload(attached);
  const res = await app.inject({ method: "POST", url: "/files/widget/w1", ...multipartBody([
    { name: "scan", filename: "a.stl", buffer: Buffer.from("abc") }, { name: "photo", filename: "b.jpg", buffer: Buffer.from("def") },
  ]) });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(attached[0].files.map((f) => [f.kind, f.originalName]), [["scan", "a.stl"], ["photo", "b.jpg"]]);
  assert.equal(attached[0].byUserId, "u1");
});

test("multipart upload: a file over the size limit is a 413, not a 500", async () => {
  const attached = [];
  const app = await buildUpload(attached);
  const res = await app.inject({ method: "POST", url: "/files/widget/w1", ...multipartBody([
    { name: "scan", filename: "big.stl", buffer: Buffer.alloc(MAX_FILE_SIZE_BYTES + 1) },
  ]) });
  assert.equal(res.statusCode, 413);
  assert.match(res.json().error.message, /75 MB/);
  assert.equal(attached.length, 0);
});

test("multipart upload: more than 10 files is a 413, not a 500", async () => {
  const attached = [];
  const app = await buildUpload(attached);
  const parts = Array.from({ length: RECORD_FILES_MAX_COUNT + 1 }, (_, i) => ({ name: "scan", filename: `f${i}.stl`, buffer: Buffer.from("x") }));
  const res = await app.inject({ method: "POST", url: "/files/widget/w1", ...multipartBody(parts) });
  assert.equal(res.statusCode, 413);
  assert.match(res.json().error.message, /Too many files/);
  assert.equal(attached.length, 0);
});
