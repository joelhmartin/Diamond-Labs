import { test, vi, afterEach } from "vitest";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

const { env } = await import("./env.js");

test("carriers default to the sandbox and image labels", () => {
  assert.equal(env.CARRIER_ENV, "sandbox");
  assert.equal(env.LABEL_FORMAT, "image");
});

test("shipping is not billed until the lab decides (the one business decision)", () => {
  assert.equal(env.SHIPPING_CHARGE_POLICY, "none");
  assert.equal(env.SHIPPING_FLAT_CENTS, 0);
});

test("the shipped email is on by default", () => {
  assert.equal(env.SHIPPED_EMAIL_ENABLED, true);
});

async function loadWith(vars) {
  vi.resetModules();
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; process.env[k] = vars[k]; }
  try { return (await import("./env.js")).env; } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
afterEach(() => vi.restoreAllMocks());

test("flat policy needs a positive SHIPPING_FLAT_CENTS, else boot fails", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation((code) => { throw new Error(`exit ${code}`); });
  await assert.rejects(loadWith({ SHIPPING_CHARGE_POLICY: "flat", SHIPPING_FLAT_CENTS: "0" }), /exit 1/);
  assert.match(String(console.error.mock.calls.at(-1)[0]), /SHIPPING_FLAT_CENTS/);
  const env = await loadWith({ SHIPPING_CHARGE_POLICY: "flat", SHIPPING_FLAT_CENTS: "1200" });
  assert.equal(env.SHIPPING_FLAT_CENTS, 1200);
  assert.equal((await loadWith({ SHIPPING_CHARGE_POLICY: "carrier_cost", SHIPPING_FLAT_CENTS: "0" })).SHIPPING_CHARGE_POLICY, "carrier_cost");
});
