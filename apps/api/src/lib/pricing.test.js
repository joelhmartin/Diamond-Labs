import { test } from "vitest";
import assert from "node:assert/strict";
import { priceLines, unitPriceFor, PricingError } from "./pricing.js";

const config = { taxRateBps: 800, shippingFlatCents: 1200, maxQty: 999 };
const v = (id, over = {}) => ({
  id, code: `C${id}`, name: `Item ${id}`, basePriceCents: 1000, taxable: false,
  active: true, catalogId: null, legacySeazonaProductId: null, ...over,
});
const variants = new Map([
  ["a", v("a", { basePriceCents: 2000, taxable: true })],
  ["b", v("b", { basePriceCents: 500 })],
  ["off", v("off", { active: false })],
  ["nop", v("nop", { basePriceCents: null })],
]);
const code = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof PricingError); return e.code; } assert.fail("expected PricingError"); };

test("a client's negotiated price wins over base", () => {
  assert.deepEqual(unitPriceFor(variants.get("a"), 1500), { cents: 1500, source: "client" });
  assert.deepEqual(unitPriceFor(variants.get("a"), undefined), { cents: 2000, source: "base" });
});

test("a negotiated $0.00 is a real price, not a missing one", () => {
  assert.deepEqual(unitPriceFor(variants.get("a"), 0), { cents: 0, source: "client" });
});

test("guests pay base; tax applies only to taxable lines; flat shipping", () => {
  const q = priceLines({ lines: [{ variantId: "a", qty: 1 }, { variantId: "b", qty: 2 }], variants, config });
  assert.equal(q.subtotalCents, 3000);
  assert.equal(q.taxCents, 160);          // 8% of the 2000 taxable line only
  assert.equal(q.shippingCents, 1200);
  assert.equal(q.totalCents, 4360);
  assert.equal(q.lines[0].priceSource, "base");
});

test("client prices flow into the totals", () => {
  const q = priceLines({ lines: [{ variantId: "a", qty: 1 }], variants, clientPrices: new Map([["a", 1500]]), config });
  assert.equal(q.lines[0].unitCents, 1500);
  assert.equal(q.lines[0].priceSource, "client");
  assert.equal(q.taxCents, 120);
});

test("an all-free cart charges no shipping", () => {
  const q = priceLines({ lines: [{ variantId: "a", qty: 1 }], variants, clientPrices: new Map([["a", 0]]), config });
  assert.equal(q.subtotalCents, 0);
  assert.equal(q.shippingCents, 0);
  assert.equal(q.totalCents, 0);
});

test("the same variant on two lines is merged before the quantity cap", () => {
  const q = priceLines({ lines: [{ variantId: "b", qty: 2 }, { variantId: "b", qty: 3 }], variants, config });
  assert.equal(q.lines.length, 1);
  assert.equal(q.lines[0].qty, 5);
  assert.equal(code(() => priceLines({ lines: [{ variantId: "b", qty: 600 }, { variantId: "b", qty: 600 }], variants, config })), "QTY_LIMIT");
});

test("unknown, inactive and unpriced variants are refused, never guessed", () => {
  assert.equal(code(() => priceLines({ lines: [{ variantId: "zzz", qty: 1 }], variants, config })), "UNAVAILABLE");
  assert.equal(code(() => priceLines({ lines: [{ variantId: "off", qty: 1 }], variants, config })), "UNAVAILABLE");
  assert.equal(code(() => priceLines({ lines: [{ variantId: "nop", qty: 1 }], variants, config })), "UNPRICED");
});

test("bad quantities and empty carts are refused", () => {
  assert.equal(code(() => priceLines({ lines: [], variants, config })), "EMPTY");
  assert.equal(code(() => priceLines({ lines: [{ variantId: "a", qty: 0 }], variants, config })), "BAD_QTY");
  assert.equal(code(() => priceLines({ lines: [{ variantId: "a", qty: 1.5 }], variants, config })), "BAD_QTY");
});
