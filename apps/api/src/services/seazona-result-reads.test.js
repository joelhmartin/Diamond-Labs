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

test("a full capped page sharing one lastModified fails the walk (truncated), never skips past it (F3)", async () => {
  const stamped = Array.from({ length: 10_000 }, (_, i) => ({ id: `i${i}`, lastModified: "2025-11-29T15:05:50" }));
  const f = stub(ok(stamped), ok([{ id: "late", lastModified: "2026-01-02T00:00:00" }]));
  const r = await seazona.getAllInvoicesResult();
  assert.equal(r.truncated, true, "rows past the cap with the same stamp may exist");
  assert.equal(r.budgetExhausted, false);
  assert.equal(r.requests, 1, "no request past the shared stamp");
  assert.equal(f.mock.calls.length, 1);
});

test("a full page whose newest stamp is shared by only some rows re-requests from that stamp", async () => {
  const mixed = Array.from({ length: 10_000 }, (_, i) => ({ id: `m${i}`, lastModified: i < 5_000 ? "2025-11-29T15:05:50" : "2025-12-01T00:00:00" }));
  const f = stub(ok(mixed), ok([{ id: "late", lastModified: "2026-01-02T00:00:00" }]));
  const r = await seazona.getAllInvoicesResult();
  assert.equal(r.truncated, false);
  assert.equal(r.invoices.length, 10_001);
  assert.equal(query(f, 1, "lastModified"), "2025-12-01T00:00:00");
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

const page = (n, make) => Array.from({ length: n }, (_, i) => make(i));

test("a capped page whose newest value does not advance the cursor stops the walk as truncated", async () => {
  // equal to the cursor instant (cursor carries Z, record value does not)
  const same = page(10_000, (i) => ({ id: `a${i}`, ordered: i === 0 ? "1900-01-01T00:00:00" : "1899-12-31T00:00:00" }));
  const f = stub(ok(same), ok([]));
  const r = await seazona.getAllOrdersResult();
  assert.equal(r.truncated, true);
  assert.equal(r.requests, 1);
  assert.equal(f.mock.calls.length, 1);
  // backwards
  const back = page(10_000, (i) => ({ id: `b${i}`, ordered: "1800-01-01T00:00:00" }));
  stub(ok(back));
  assert.equal((await seazona.getAllOrdersResult()).truncated, true);
});

test("exhausting the page budget is reported as truncated", async () => {
  let n = 0;
  const f = vi.fn(async () => { n += 1; return ok(page(10_000, (i) => ({ id: `p${n}-${i}`, ordered: minuteStamp(n * 20_000 + i) }))); });
  vi.stubGlobal("fetch", f);
  const r = await seazona.getAllOrdersResult();
  assert.equal(r.requests, 50);
  assert.equal(r.truncated, true);
});

test("a normal end (empty or short page) is not truncated", async () => {
  stub(ok([]));
  const r = await seazona.getAllOrdersResult();
  assert.equal(r.truncated, false);
  assert.equal(r.reachable, true);
  stub(ok([{ id: "x", lastModified: "2024-01-01T00:00:00" }]));
  assert.equal((await seazona.getAllInvoicesResult()).truncated, false);
});

test("records without an id are all kept, not collapsed into one", async () => {
  stub(ok([{ ordered: "2024-01-01T00:00:00" }, { ordered: "2024-01-02T00:00:00" }, { id: "k", ordered: "2024-01-03T00:00:00" }]));
  assert.equal((await seazona.getAllOrdersResult()).orders.length, 3);
});

test("a 2xx with a junk body is not an ok list read", async () => {
  stub(ok({ message: "nope" }));
  assert.deepEqual(await seazona.listProductsResult(), { ok: false, status: 200, products: [] });
});

test("a capped page of one unparseable timestamp is a truncated walk, not a RangeError", async () => {
  const junk = page(10_000, (i) => ({ id: `j${i}`, lastModified: "not-a-date" }));
  stub(ok(junk));
  const r = await seazona.getAllInvoicesResult();
  assert.equal(r.truncated, true);
  assert.equal(r.requests, 1);
});

test("an unparseable value among parseable ones is ignored when choosing the cursor", async () => {
  const mixed = page(10_000, (i) => ({ id: `m${i}`, lastModified: i === 0 ? "garbage" : minuteStamp(i) }));
  const f = stub(ok(mixed), ok([]));
  const r = await seazona.getAllInvoicesResult();
  assert.equal(r.truncated, false);
  assert.equal(query(f, 1, "lastModified"), minuteStamp(9999));
});

test("a walk honours maxPages and awaits beforePage before every page; no options keeps the default budget", async () => {
  let n = 0;
  const f = vi.fn(async () => { n += 1; return ok(page(10_000, (i) => ({ id: `q${n}-${i}`, ordered: minuteStamp(n * 20_000 + i) }))); });
  vi.stubGlobal("fetch", f);
  let paced = 0;
  const r = await seazona.getAllOrdersResult({ maxPages: 3, beforePage: async () => { paced += 1; } });
  assert.equal(r.requests, 3);
  assert.equal(r.truncated, true, "out of pages mid-walk is truncated");
  assert.equal(r.budgetExhausted, true);
  assert.equal(paced, 3);
  assert.equal(f.mock.calls.length, 3);
});

test("a stall on the last allowed page is truncated but not budgetExhausted", async () => {
  const same = page(10_000, (i) => ({ id: `s${i}`, ordered: i === 0 ? "1900-01-01T00:00:00" : "1899-12-31T00:00:00" }));
  stub(ok(same));
  const r = await seazona.getAllOrdersResult({ maxPages: 1 });
  assert.equal(r.truncated, true);
  assert.equal(r.budgetExhausted, false);
});
