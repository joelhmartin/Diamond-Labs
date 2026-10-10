import { test, vi, afterEach } from "vitest";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";
process.env.SEAZONA_API_KEY ||= "test-key";
process.env.SEAZONA_SECRET ||= "test-secret";
process.env.SEAZONA_BASE_URL ||= "https://example.invalid/";
delete process.env.SEAZONA_DISABLED;

const seazona = await import("./seazona.service.js");
afterEach(() => vi.unstubAllGlobals());

test("unset SEAZONA_DISABLED: behaviour is unchanged (real call, health not disabled)", async () => {
  const f = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => [] }));
  vi.stubGlobal("fetch", f);
  const h = await seazona.checkHealth();
  assert.equal(f.mock.calls.length, 1);
  assert.equal(h.ok, true);
  assert.notEqual(h.disabled, true);
});
