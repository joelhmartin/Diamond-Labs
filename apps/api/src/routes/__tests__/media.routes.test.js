import { test, vi } from "vitest";
import assert from "node:assert/strict";
import Fastify from "fastify";
import multipart from "@fastify/multipart";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";
delete process.env.MEDIA_GCS_BUCKET; // exercise the local-disk fallback

let currentUser = { id: "u1", role: "admin", approvalStatus: "approved", email: "x@y.z", name: "X" };
vi.mock("../../middleware/authenticate.js", () => ({
  authenticate: async (request) => { request.user = currentUser; },
}));

const mediaRoutes = (await import("../media.routes.js")).default;
const { sniffImageType, MAX_IMAGE_BYTES } = await import("../../services/media.service.js");

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);

async function app(role = "admin") {
  currentUser = { ...currentUser, role };
  const a = Fastify();
  await a.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });
  await a.register(mediaRoutes, { prefix: "/api/v1" });
  return a;
}

function multipartBody(buffer, filename = "photo.png", type = "image/png") {
  const boundary = "----mediatest";
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`;
  return {
    payload: Buffer.concat([Buffer.from(head), buffer, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

test("sniffImageType goes by the file's bytes, not its name", () => {
  assert.equal(sniffImageType(PNG), "png");
  assert.equal(sniffImageType(JPG), "jpg");
  assert.equal(sniffImageType(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(8)])), "webp");
  assert.equal(sniffImageType(Buffer.from("GIF89a" + "x".repeat(20))), "gif");
  assert.equal(sniffImageType(Buffer.from("<svg onload=alert(1)>" + "x".repeat(20))), null);
  assert.equal(sniffImageType(Buffer.from("%PDF-1.7" + "x".repeat(20))), null);
});

test("an admin uploads an image, and anyone can then fetch it by the returned URL", async () => {
  const a = await app();
  const up = await a.inject({ method: "POST", url: "/api/v1/admin/media", ...multipartBody(PNG) });
  assert.equal(up.statusCode, 201);
  const { url, name } = up.json().data;
  assert.match(name, /^[0-9a-f-]{36}\.png$/, "stored under a random name, never the uploader's filename");
  assert.equal(url, `/api/v1/media/${name}`);

  const got = await a.inject({ method: "GET", url });
  assert.equal(got.statusCode, 200);
  assert.equal(got.headers["content-type"], "image/png");
  assert.match(got.headers["cache-control"], /immutable/);
  assert.deepEqual(got.rawPayload, PNG);
});

test("the stored type follows the bytes even when the browser lies about it", async () => {
  const a = await app();
  const up = await a.inject({ method: "POST", url: "/api/v1/admin/media", ...multipartBody(JPG, "x.png", "image/png") });
  assert.equal(up.statusCode, 201);
  assert.match(up.json().data.name, /\.jpg$/);
});

test("non-images are refused", async () => {
  const a = await app();
  const svg = await a.inject({ method: "POST", url: "/api/v1/admin/media", ...multipartBody(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>" + " ".repeat(20)), "x.svg", "image/svg+xml") });
  assert.equal(svg.statusCode, 415);
});

test("images over 5 MB are refused", async () => {
  const a = await app();
  const big = Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES + 1)]);
  const res = await a.inject({ method: "POST", url: "/api/v1/admin/media", ...multipartBody(big) });
  assert.equal(res.statusCode, 413);
});

test("only admins can upload", async () => {
  const a = await app("doctor");
  const res = await a.inject({ method: "POST", url: "/api/v1/admin/media", ...multipartBody(PNG) });
  assert.equal(res.statusCode, 403);
});

test("the public route only serves well-formed media names — no path traversal", async () => {
  const a = await app();
  for (const name of ["..%2F..%2Fpackage.json", "x.png", "00000000-0000-0000-0000-000000000000.svg", "%2e%2e%2f.env"]) {
    const res = await a.inject({ method: "GET", url: `/api/v1/media/${name}` });
    assert.equal(res.statusCode, 404, name);
  }
  const missing = await a.inject({ method: "GET", url: "/api/v1/media/00000000-0000-0000-0000-000000000000.png" });
  assert.equal(missing.statusCode, 404);
});
