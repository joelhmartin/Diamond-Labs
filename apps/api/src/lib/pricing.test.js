import { test } from "vitest";
import assert from "node:assert/strict";
import { priceLines, priceLabLines, unitPriceFor, assertQuotedTotal, PricingError } from "./pricing.js";

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

test("a client price makes an unpriced (null base) variant billable to that client only", () => {
  assert.deepEqual(unitPriceFor(variants.get("nop"), 750), { cents: 750, source: "client" });
  const q = priceLines({ lines: [{ variantId: "nop", qty: 2 }], variants, clientPrices: new Map([["nop", 750]]), config });
  assert.equal(q.lines[0].lineCents, 1500);
  assert.equal(q.lines[0].priceSource, "client");
  assert.equal(code(() => priceLines({ lines: [{ variantId: "nop", qty: 1 }], variants, config })), "UNPRICED");
});

test("a mixed free + paid cart ships and taxes on the paid part only", () => {
  const q = priceLines({
    lines: [{ variantId: "a", qty: 1 }, { variantId: "b", qty: 1 }],
    variants, clientPrices: new Map([["a", 0]]), config,
  });
  assert.equal(q.lines.find((l) => l.variantId === "a").lineCents, 0);
  assert.equal(q.subtotalCents, 500);
  assert.equal(q.taxCents, 0);            // the taxable line is the free one
  assert.equal(q.shippingCents, 1200);
  assert.equal(q.totalCents, 1700);
});

test("checkout refuses any total other than the one the shopper was quoted", () => {
  const quote = { totalCents: 4360 };
  assert.doesNotThrow(() => assertQuotedTotal(43.6, quote));
  assert.doesNotThrow(() => assertQuotedTotal("43.60", quote));
  assert.equal(code(() => assertQuotedTotal(43.59, quote)), "PRICE_CHANGED");
  assert.equal(code(() => assertQuotedTotal(43.61, quote)), "PRICE_CHANGED");
  assert.equal(code(() => assertQuotedTotal(undefined, quote)), "PRICE_CHANGED");
  assert.equal(code(() => assertQuotedTotal("abc", quote)), "PRICE_CHANGED");
  assert.doesNotThrow(() => assertQuotedTotal(0, { totalCents: 0 }));
});

test("lab lines: client price, else base; unknown or unpriced variants are flagged, never refused", () => {
  const variants = new Map([
    ["v1", { id: "v1", basePriceCents: 45000, taxable: false, active: true }],
    ["v2", { id: "v2", basePriceCents: null, taxable: true, active: true }],
    ["v3", { id: "v3", basePriceCents: 1200, taxable: true, active: false }],
  ]);
  const out = priceLabLines({
    lines: [
      { id: "a", variantId: "v1", code: "2608", name: "DDSO Nylon", qty: 1, noteOnly: false },
      { id: "b", variantId: "v2", code: "2700", name: "No price yet", qty: 2, noteOnly: false },
      { id: "c", variantId: null, code: "9999", name: "Unknown code", qty: 1, noteOnly: false },
      { id: "d", variantId: "v3", code: "61", name: "Retired item", qty: 1, noteOnly: false },
      { id: "e", variantId: null, code: null, name: "Bite in CR", qty: 1, noteOnly: true },
    ],
    variants,
    clientPrices: new Map([["v1", 40500]]),
  });
  assert.deepEqual(out.map((l) => [l.labOrderLineId, l.unitCents, l.priceSource, l.qty, l.taxable]), [
    ["a", 40500, "client", 1, false],
    ["b", 0, "unpriced", 2, true],
    ["c", 0, "unpriced", 1, false],
    ["d", 1200, "base", 1, true],
  ]);
  assert.equal(out[0].description, "DDSO Nylon");
});
