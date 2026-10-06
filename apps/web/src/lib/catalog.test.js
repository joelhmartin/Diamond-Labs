import { test } from "vitest";
import assert from "node:assert/strict";
import { familyToProduct, variantFor, variantLabel, cartItemFor, migrateCart } from "./catalog.js";

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
  assert.equal(item.price, 24.99);
  assert.equal(variantLabel(single, single.variants[0]), "Mute");
});

test("carts saved before variants existed are emptied, not sent to checkout", () => {
  const old = { items: [{ id: "16", name: "NovaDent", price: 15, qty: 1 }], isOpen: false };
  assert.deepEqual(migrateCart(old, 0).items, []);
  const kept = { items: [{ id: "v-l", variantId: "v-l", qty: 1 }] };
  assert.equal(migrateCart(kept, 0).items.length, 1);
});
