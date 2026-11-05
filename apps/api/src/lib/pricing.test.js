import { test } from "vitest";
import assert from "node:assert/strict";
import { priceLines, priceLabLines, unitPriceFor, assertQuotedTotal, resolveClientPrices, liveLists, PricingError } from "./pricing.js";
import { asRemakeLines } from "../services/billing/invoice-rules.js";

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

// --- Price lists (piece 10): one resolution path, R1 precedence ---

const list = (listId, entries, name = `List ${listId}`) => ({ listId, name, items: new Map(entries) });

test("client override beats every list", () => {
  const out = resolveClientPrices({
    overrides: new Map([["a", 1500]]),
    lists: [list("L1", [["a", 1200], ["b", 400]]), list("L2", [["a", 1100]])],
  });
  assert.deepEqual(out.get("a"), { cents: 1500, source: "client", listId: null, listName: null });
  assert.deepEqual(out.get("b"), { cents: 400, source: "list", listId: "L1", listName: "List L1" });
});

test("first assigned list with an item wins; a later list fills variants the first lacks", () => {
  const out = resolveClientPrices({
    overrides: new Map(),
    lists: [list("L1", [["a", 1200]], "Standard"), list("L2", [["a", 900], ["b", 300]], "Remake")],
  });
  assert.deepEqual(out.get("a"), { cents: 1200, source: "list", listId: "L1", listName: "Standard" });
  assert.deepEqual(out.get("b"), { cents: 300, source: "list", listId: "L2", listName: "Remake" });
  assert.equal(out.has("c"), false, "no list item and no override: base applies downstream");
});

test("a list price of $0.00 is a real price", () => {
  const out = resolveClientPrices({ overrides: new Map(), lists: [list("L1", [["a", 0]])] });
  assert.equal(out.get("a").cents, 0);
});

test("unitPriceFor takes a resolved { cents, source } and passes the source through", () => {
  assert.deepEqual(unitPriceFor(variants.get("a"), { cents: 1200, source: "list" }), { cents: 1200, source: "list" });
  assert.deepEqual(unitPriceFor(variants.get("a"), { cents: 1500, source: "client" }), { cents: 1500, source: "client" });
  assert.deepEqual(unitPriceFor(variants.get("nop"), { cents: 700, source: "list" }), { cents: 700, source: "list" });
  assert.deepEqual(unitPriceFor(variants.get("a"), undefined), { cents: 2000, source: "base" });
});

test("priceLabLines marks a list-priced line priceSource \"list\"", () => {
  const out = priceLabLines({
    lines: [
      { id: "x", variantId: "a", code: "Ca", name: "Item a", qty: 1, noteOnly: false },
      { id: "y", variantId: "b", code: "Cb", name: "Item b", qty: 1, noteOnly: false },
    ],
    variants,
    clientPrices: new Map([["a", { cents: 1700, source: "list" }]]),
  });
  assert.deepEqual(out.map((l) => [l.unitCents, l.priceSource]), [[1700, "list"], [500, "base"]]);
});

test("a remake stays $0 even when list-priced", () => {
  const priced = priceLabLines({
    lines: [{ id: "x", variantId: "a", code: "Ca", name: "Item a", qty: 1, noteOnly: false }],
    variants,
    clientPrices: new Map([["a", { cents: 1700, source: "list" }]]),
  });
  assert.equal(priced[0].priceSource, "list");
  const remade = asRemakeLines(priced);
  assert.equal(remade[0].unitCents, 0);
  assert.equal(remade[0].priceSource, "remake");
});

test("a list edit between quote and checkout is PRICE_CHANGED, not a silent charge", () => {
  const lines = [{ variantId: "b", qty: 2 }];
  const priceWith = (listCents) => {
    const resolved = resolveClientPrices({ overrides: new Map(), lists: [list("L1", [["b", listCents]])] });
    return priceLines({ lines, variants, clientPrices: resolved, config });
  };
  const quoted = priceWith(400);
  assert.equal(quoted.lines[0].priceSource, "list");
  const atCheckout = priceWith(450);           // staff edited the list after the quote
  assert.equal(code(() => assertQuotedTotal(quoted.totalCents / 100, atCheckout)), "PRICE_CHANGED");
  assert.doesNotThrow(() => assertQuotedTotal(quoted.totalCents / 100, priceWith(400)));
});

test("liveLists keeps assignment order and drops archived and unknown lists", () => {
  const byId = new Map([
    ["L1", { listId: "L1", name: "Gold", archived: false, items: new Map() }],
    ["L2", { listId: "L2", name: "Old", archived: true, items: new Map() }],
    ["L3", { listId: "L3", name: "Silver", archived: false, items: new Map() }],
  ]);
  assert.deepEqual(liveLists(["L3", "L2", "L1", "LX"], byId).map((l) => l.listId), ["L3", "L1"]);
});
