import { test } from "vitest";
import assert from "node:assert/strict";
import {
  productFamilies, productOptions, productOptionValues, productVariants,
  productVariantOptionValues, clientPrices, orderItems, orders,
} from "./index.js";

const has = (table, cols) => {
  const keys = Object.keys(table);
  for (const c of cols) assert.ok(keys.includes(c), `missing column: ${c}`);
};

test("catalog tables expose the columns the services depend on", () => {
  has(productFamilies, ["id", "slug", "name", "description", "category", "imageUrl", "channel", "active", "position"]);
  has(productOptions, ["id", "familyId", "name", "position"]);
  has(productOptionValues, ["id", "optionId", "value", "position"]);
  has(productVariants, ["id", "familyId", "code", "name", "basePriceCents", "taxable", "active", "catalogId", "legacySeazonaProductId"]);
  has(productVariantOptionValues, ["variantId", "optionValueId"]);
});

test("client prices are cents with a provenance", () => {
  has(clientPrices, ["id", "clientUserId", "variantId", "priceCents", "source", "reviewedAt", "reviewedBy", "note"]);
});

test("order items can point at a variant and no longer require a shop SKU", () => {
  has(orderItems, ["variantId", "catalogId"]);
  assert.equal(orderItems.catalogId.notNull, false);
});

test("orders record who was priced and each line's price source", () => {
  has(orders, ["pricedForUserId"]);
  has(orderItems, ["priceSource"]);
  assert.equal(orders.pricedForUserId.notNull, false);
  assert.equal(orderItems.priceSource.notNull, false);
});
