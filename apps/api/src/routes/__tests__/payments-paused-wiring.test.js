import { test } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// Kept byte-identical on main and feat/own-the-lab, so it finds each route in
// whichever file registers it (the two branches lay routes out differently).
// It slices registrations itself instead of importing _source.js, which main lacks.
const routesDir = fileURLToPath(new URL("..", import.meta.url));
const sources = readdirSync(routesDir).filter((f) => f.endsWith(".routes.js")).map((f) => readFileSync(join(routesDir, f), "utf8"));

function registration(marker) {
  for (const src of sources) {
    const start = src.indexOf(marker);
    if (start < 0) continue;
    const next = src.indexOf("\n  fastify.", start + marker.length);
    return src.slice(start, next === -1 ? src.length : next);
  }
  return null;
}

// Every route that starts a card payment or writes the invoice ledger by hand.
const ALWAYS = [
  'fastify.post("/payments/charge-saved",',
  'fastify.post("/payments/hosted-token",',
  'fastify.post("/admin/users/:userId/payments/charge-saved",',
  'fastify.post("/admin/payments/refund",',
];
// Manual ledger writes: main has offline-payment; feat/own-the-lab has credit + manual payments.
const MANUAL = [
  'fastify.post("/admin/invoices/:invoiceId/offline-payment",',
  'fastify.post("/admin/invoices/:id/credit",',
  'fastify.post("/admin/clients/:userId/payments",',
];

test("every payment-starting route is behind the PAYMENTS_PAUSED guard", () => {
  for (const m of ALWAYS) {
    const src = registration(m);
    assert.ok(src, `route not found: ${m}`);
    assert.match(src, /paymentsPaused/, `${m} is not paused`);
  }
  const manual = MANUAL.map(registration).filter(Boolean);
  assert.ok(manual.length > 0, "no manual-payment route found: the guard list is stale");
  for (const src of manual) assert.match(src, /paymentsPaused/, src.slice(0, 80));
});

test("hosted-complete is never paused: the card was already captured when it runs", () => {
  const src = registration('fastify.post("/payments/hosted-complete",');
  assert.ok(src);
  assert.doesNotMatch(src, /paymentsPaused/);
});
