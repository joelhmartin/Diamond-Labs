import { test } from "vitest";
import assert from "node:assert/strict";
import { reqSerializer } from "./log-serializers.js";

// B3 — GET /admin/rx-cases?q=<patient name> must never write the decrypted
// patient name into request logs (Cloud Logging in production). Fastify's
// default req serializer logs the full url including the query string; this
// custom one must strip it.

test("strips the query string from the logged url", () => {
  const out = reqSerializer({ method: "GET", url: "/admin/rx-cases?q=Jane+Doe", id: "req-1", ip: "1.2.3.4" });
  assert.equal(out.url, "/admin/rx-cases");
  assert.doesNotMatch(out.url, /Jane/);
});

test("a url with multiple query params still loses the whole query string, not just the first param", () => {
  const out = reqSerializer({ method: "GET", url: "/admin/rx-cases?status=new&q=Jane+Doe&limit=50", id: "req-2", ip: "1.2.3.4" });
  assert.equal(out.url, "/admin/rx-cases");
});

test("a url with no query string passes through unchanged", () => {
  const out = reqSerializer({ method: "GET", url: "/admin/rx-cases/abc123", id: "req-3", ip: "1.2.3.4" });
  assert.equal(out.url, "/admin/rx-cases/abc123");
});

test("keeps method, id, and remoteAddress — the fields other log lines actually need", () => {
  const out = reqSerializer({ method: "POST", url: "/api/v1/payments/charge", id: "req-4", ip: "5.6.7.8" });
  assert.equal(out.method, "POST");
  assert.equal(out.id, "req-4");
  assert.equal(out.remoteAddress, "5.6.7.8");
});

test("does not throw on a malformed/missing url", () => {
  assert.doesNotThrow(() => reqSerializer({ method: "GET", id: "req-5", ip: "1.2.3.4" }));
  const out = reqSerializer({ method: "GET", id: "req-5", ip: "1.2.3.4" });
  assert.equal(out.url, undefined);
});
