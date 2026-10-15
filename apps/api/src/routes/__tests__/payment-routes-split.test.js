import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
// Lines that count toward the 1,000-line cap: not blank, not a comment.
const codeLines = (src) =>
  src.split("\n").filter((l) => {
    const t = l.trim();
    return t && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
  }).length;

const FILES = {
  "../checkout.routes.js": ['fastify.post("/payments/checkout",'],
  "../saved-cards.routes.js": [
    'fastify.get("/payments/saved-cards",', 'fastify.put("/payments/saved-cards/:profileId/default",',
    'fastify.post("/payments/saved-cards/hosted-token",', 'fastify.put("/payments/saved-cards/:profileId",',
    'fastify.delete("/payments/saved-cards/:profileId",',
  ],
  "../invoice-payment.routes.js": [
    'fastify.post("/payments/charge-saved",', 'fastify.post("/payments/hosted-token",', 'fastify.post("/payments/hosted-complete",',
  ],
  "../refund.routes.js": ['fastify.post("/admin/payments/refund",'],
  "../payment.routes.js": [
    'fastify.get("/payments/history",', 'fastify.get("/admin/payments",', 'fastify.get("/admin/payments/audit",',
    'fastify.post("/payments/test/hosted-token",', 'fastify.post("/payments/test/hosted-complete",',
  ],
};

test("every payment route lives in exactly one module, along its seam", () => {
  const all = Object.values(FILES).flat();
  for (const [file, markers] of Object.entries(FILES)) {
    const src = read(file);
    for (const m of markers) assert.ok(src.includes(m), `${m} missing from ${file}`);
    for (const other of all.filter((m) => !markers.includes(m))) assert.ok(!src.includes(other), `${other} also in ${file}`);
  }
});

test("each payment module stays under the 1,000-line cap", () => {
  for (const file of [...Object.keys(FILES), "../payment-replies.js"]) {
    assert.ok(codeLines(read(file)) < 1000, `${file} is over the cap`);
  }
});

test("the server registers every payment module", () => {
  const index = read("../../index.js");
  for (const name of ["checkoutRoutes", "savedCardRoutes", "invoicePaymentRoutes", "refundRoutes", "paymentRoutes"]) {
    assert.match(index, new RegExp(`await fastify\\.register\\(${name},\\s*\\{ prefix: "/api/v1" \\}\\)`), name);
  }
});
