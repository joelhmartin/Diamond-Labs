import { test, vi, afterEach } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";
process.env.SEAZONA_API_KEY ||= "test-key";
process.env.SEAZONA_SECRET ||= "test-secret";
process.env.SEAZONA_BASE_URL ||= "https://example.invalid/";
process.env.SEAZONA_DISABLED = "true";

const seazona = await import("./seazona.service.js");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("disabled: every exported entry point makes zero network calls and resolves empty", async () => {
  const f = vi.fn(async () => {
    throw new Error("network must not be touched");
  });
  vi.stubGlobal("fetch", f);
  const spies = [
    vi.spyOn(console, "log").mockImplementation(() => {}),
    vi.spyOn(console, "warn").mockImplementation(() => {}),
    vi.spyOn(console, "error").mockImplementation(() => {}),
  ];

  assert.deepEqual(await seazona.listClients(), []);
  assert.equal(await seazona.getClient(1), null);
  assert.equal(await seazona.checkLoginExists("a@b.com"), null);
  assert.equal(await seazona.findClientByPhone("5551234567"), null);
  assert.deepEqual(await seazona.getInvoices(), []);
  assert.deepEqual(await seazona.getAllInvoices(), []);
  assert.equal(await seazona.getInvoice(1), null);
  assert.deepEqual(await seazona.getOrders(), []);
  assert.equal(await seazona.getOrder(1), null);
  assert.equal(await seazona.createOrder({ clientId: 1, items: [] }), null);
  assert.equal(await seazona.createPayment({ clientId: 1, amount: 1 }), null);
  assert.equal(await seazona.getPayment(1), null);
  assert.deepEqual(await seazona.listProducts(), []);
  assert.equal(await seazona.getProduct(1), null);
  assert.deepEqual(await seazona.listUsers(), []);
  assert.equal(f.mock.calls.length, 0);

  // The GCP alert matches lines starting "[Seazona]"; a disabled call must not trip it.
  const lines = spies.flatMap((s) => s.mock.calls.map((c) => String(c[0])));
  assert.ok(lines.some((l) => l.startsWith("[SeazonaDisabled]")));
  for (const l of lines) assert.doesNotMatch(l, /^\[Seazona\]/);
  // Only the method is logged, never the request path.
  const disabled = lines.filter((l) => l.startsWith("[SeazonaDisabled]"));
  for (const l of disabled) assert.match(l, /^\[SeazonaDisabled\] [A-Z]+ skipped/);
  assert.ok(!disabled.some((l) => /v1\/|clients|invoices|orders|a@b\.com|5551234567/.test(l)));
});

test("disabled: checkHealth reports disabled, not down, with no network", async () => {
  const f = vi.fn();
  vi.stubGlobal("fetch", f);
  vi.spyOn(console, "log").mockImplementation(() => {});
  const h = await seazona.checkHealth();
  assert.equal(h.disabled, true);
  assert.equal(f.mock.calls.length, 0);
});

test("service has exactly one fetch call site (so the gate in requestRaw covers all of it)", () => {
  const src = readFileSync(new URL("./seazona.service.js", import.meta.url), "utf8");
  assert.equal(src.match(/\bfetch\(/g).length, 1);
});
