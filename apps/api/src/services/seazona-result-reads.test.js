import { test, vi, afterEach } from "vitest";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";
process.env.SEAZONA_API_KEY ||= "test-key";
process.env.SEAZONA_SECRET ||= "test-secret";
process.env.SEAZONA_BASE_URL ||= "https://example.invalid/";
delete process.env.SEAZONA_DISABLED;

const seazona = await import("./seazona.service.js");
afterEach(() => { vi.unstubAllGlobals(); seazona.__resetRateLimiter(); });

const ok = (data) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => data, text: async () => "" });
const fail = (status) => ({ ok: false, status, headers: { get: () => null }, json: async () => null, text: async () => "API access is temporarily disabled for this host" });
const stub = (...responses) => {
  const f = vi.fn(async () => responses.shift());
  vi.stubGlobal("fetch", f);
  return f;
};
const query = (f, i, name) => new URL(f.mock.calls[i][0]).searchParams.get(name);
const minuteStamp = (i) => new Date(Date.UTC(2020, 0, 1) + i * 60_000).toISOString().slice(0, 19);

test("a single-record read reports its HTTP status: a 403 block is visible to the caller", async () => {
  stub(fail(403));
  assert.deepEqual(await seazona.getInvoiceResult("inv-1"), { ok: false, status: 403, invoice: null });
  stub(ok({ id: "ord-1", products: [] }));
  assert.deepEqual(await seazona.getOrderResult("ord-1"), { ok: true, status: 200, order: { id: "ord-1", products: [] } });
});

test("list reads report status and never throw", async () => {
  stub(fail(500));
  assert.deepEqual(await seazona.listClientsResult(""), { ok: false, status: 500, clients: [] });
  stub(ok([{ id: "u1" }]));
  assert.deepEqual(await seazona.listUsersResult(), { ok: true, status: 200, users: [{ id: "u1" }] });
});

test("the orders walk pages past the 10k cap by `ordered`", async () => {
  const page1 = Array.from({ length: 10_000 }, (_, i) => ({ id: `o${i}`, ordered: minuteStamp(i) }));
  const page2 = [{ id: "o9999", ordered: minuteStamp(9999) }, { id: "o10000", ordered: minuteStamp(10_000) }, { id: "o10001", ordered: minuteStamp(10_001) }];
  const f = stub(ok(page1), ok(page2));
  const r = await seazona.getAllOrdersResult();
  assert.equal(r.reachable, true);
  assert.equal(r.requests, 2);
  assert.equal(r.orders.length, 10_002, "the overlapping row is de-duped by id");
  assert.equal(query(f, 0, "ordered"), "1900-01-01T00:00:00Z");
  assert.equal(query(f, 1, "ordered"), minuteStamp(9999));
});

test("a bulk-restamped capped page advances by one second", async () => {
  const stamped = Array.from({ length: 10_000 }, (_, i) => ({ id: `i${i}`, lastModified: "2025-11-29T15:05:50" }));
  const f = stub(ok(stamped), ok([{ id: "late", lastModified: "2026-01-02T00:00:00" }]));
  const r = await seazona.getAllInvoicesResult();
  assert.equal(r.invoices.length, 10_001);
  assert.equal(query(f, 1, "lastModified"), "2025-11-29T15:05:51Z");
});

test("a walk that hits a block stops and reports it", async () => {
  const page1 = Array.from({ length: 10_000 }, (_, i) => ({ id: `i${i}`, lastModified: minuteStamp(i) }));
  stub(ok(page1), fail(403));
  const r = await seazona.getAllInvoicesResult();
  assert.equal(r.reachable, false);
  assert.equal(r.status, 403);
  assert.equal(r.requests, 2);
});

test("the limiter constants are exported for the fetcher to import, not copy", () => {
  assert.equal(seazona.LIST_PAGE_CAP, 10_000);
  assert.equal(seazona.MAX_REQUESTS_PER_WINDOW, 50);
  assert.equal(seazona.RATE_LIMIT_WINDOW_MS, 60_000);
});
