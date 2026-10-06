import { test } from "vitest";
import assert from "node:assert/strict";
import { checkoutLinesFromQuote } from "../payment.routes.js";

test("quote lines become the order/receipt line shape, in dollars", () => {
  const lines = checkoutLinesFromQuote({
    lines: [{
      variantId: "v1", code: "61", name: "Mute Small", catalogId: "61", legacySeazonaProductId: "sz-1",
      qty: 2, unitCents: 2199, priceSource: "base", lineCents: 4398, taxable: true,
    }],
  });
  assert.deepEqual(lines, [{
    variantId: "v1", catalogId: "61", seazonaProductId: "sz-1", name: "Mute Small",
    unitPrice: 21.99, unitCents: 2199, qty: 2, lineTotal: 43.98, lineCents: 4398, taxable: true,
    priceSource: "base",
  }]);
});

test("a doctor's negotiated line keeps its price source for the order record", () => {
  const [line] = checkoutLinesFromQuote({
    lines: [{ variantId: "v1", name: "Mute", catalogId: null, legacySeazonaProductId: null, qty: 1, unitCents: 0, priceSource: "client", lineCents: 0, taxable: false }],
  });
  assert.equal(line.priceSource, "client");
  assert.equal(line.unitCents, 0);
});
