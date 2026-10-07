import { test } from "vitest";
import assert from "node:assert/strict";
import {
  currentQuote, familyToProduct, variantFor, variantLabel, cartItemFor, migrateCart,
  shopperIdentity, quoteKey, quoteLineFor, matchesShopper,
} from "./catalog.js";

const family = {
  id: "f1", slug: "mute", name: "Mute", description: "Anti-snoring", category: "Sleep", imageUrl: "/catalog/mute.webp",
  options: [{ id: "o1", name: "Size", values: [{ id: "s", value: "Small" }, { id: "l", value: "Large" }] }],
  variants: [
    { id: "v-s", code: "61S", name: "Mute Small", optionValueIds: ["s"], priceCents: 2199, priceSource: "base", taxable: true },
    { id: "v-l", code: "61L", name: "Mute Large", optionValueIds: ["l"], priceCents: 2499, priceSource: "base", taxable: true },
  ],
};
const single = { ...family, id: "f2", options: [], variants: [{ ...family.variants[0], id: "v-1", optionValueIds: [] }] };

test("a family becomes a shop card priced from its cheapest variant", () => {
  const p = familyToProduct(family);
  assert.equal(p.id, "f1");
  assert.equal(p.priceFromCents, 2199);
  assert.deepEqual(p.categories, ["Sleep"]);
  assert.equal(p.singleVariant, null);
  assert.equal(familyToProduct(single).singleVariant.id, "v-1");
});

test("the picked option values select exactly one variant", () => {
  assert.equal(variantFor(family, ["l"]).id, "v-l");
  assert.equal(variantFor(family, []), null);
  assert.equal(variantFor(single, []).id, "v-1");
});

test("a cart line is keyed by variant and labelled with its options", () => {
  const item = cartItemFor(family, family.variants[1]);
  assert.equal(item.id, "v-l");
  assert.equal(item.variantId, "v-l");
  assert.equal(item.name, "Mute — Large");
  assert.equal("price" in item, false); // no add-time price copy; the quote prices the cart
  assert.equal(variantLabel(single, single.variants[0]), "Mute");
});

test("carts saved before variants existed are emptied, not sent to checkout", () => {
  const old = { items: [{ id: "16", name: "NovaDent", price: 15, qty: 1 }], isOpen: false };
  assert.deepEqual(migrateCart(old, 0).items, []);
  const kept = { items: [{ id: "v-l", variantId: "v-l", qty: 1 }] };
  assert.equal(migrateCart(kept, 0).items.length, 1);
});

test("a family with no variants has no from-price instead of Infinity", () => {
  assert.equal(familyToProduct({ ...family, variants: [] }).priceFromCents, null);
});

test("a quote only counts for the cart it was priced from", () => {
  const state = { key: "[[\"v-s\",1]]", quote: { totalCents: 100 } };
  assert.equal(currentQuote(state, state.key).totalCents, 100);
  assert.equal(currentQuote(state, "[[\"v-s\",2]]"), null);
  assert.equal(currentQuote(null, state.key), null);
});

test("no shopper identity until auth has resolved, then the user id or guest", () => {
  assert.equal(shopperIdentity({ isLoading: true, user: null }), null);
  assert.equal(shopperIdentity({ isLoading: true, user: { id: "u1" } }), null);
  assert.equal(shopperIdentity({ isLoading: false, user: null }), "guest");
  assert.equal(shopperIdentity({ isLoading: false, user: { id: "u1" } }), "u1");
});

test("the quote key changes with the shopper, so a login or lost session re-prices", () => {
  const items = [{ variantId: "v-s", qty: 1 }];
  assert.notEqual(quoteKey(items, "guest"), quoteKey(items, "u1"));
  assert.notEqual(quoteKey(items, "u1"), quoteKey([{ variantId: "v-s", qty: 2 }], "u1"));
  assert.equal(quoteKey(items, "u1"), quoteKey([{ variantId: "v-s", qty: 1, name: "x" }], "u1"));
  // A doctor's quote never answers for the guest cart (and vice versa).
  const state = { key: quoteKey(items, "u1"), quote: { totalCents: 100 } };
  assert.equal(currentQuote(state, quoteKey(items, "guest")), null);
  // requote() bumps the nonce: the old quote stops counting until the new one lands.
  assert.notEqual(quoteKey(items, "u1", 1), quoteKey(items, "u1", 0));
});

test("cart lines read their prices from the matching quote line", () => {
  const quote = { lines: [{ variantId: "v-s", unitCents: 1999, lineCents: 3998 }] };
  assert.equal(quoteLineFor(quote, "v-s").lineCents, 3998);
  assert.equal(quoteLineFor(quote, "v-l"), null);
  assert.equal(quoteLineFor(null, "v-s"), null);
});

test("data only counts for the shopper it was fetched for", () => {
  const entry = { identity: "doc-1", products: [1] };
  assert.equal(matchesShopper(entry, "doc-1"), true);
  assert.equal(matchesShopper(entry, "guest"), false);
  assert.equal(matchesShopper(entry, null), false);
  assert.equal(matchesShopper(null, "guest"), false);
});
