import { test } from "vitest";
import assert from "node:assert/strict";
import {
  familyCreateSchema, familyUpdateSchema, optionCreateSchema, variantUpdateSchema,
  clientPriceUpsertSchema, cartLinesSchema, checkoutSchema,
} from "@my-app/shared";

test("a family needs a name and a url-safe slug", () => {
  assert.equal(familyCreateSchema.safeParse({ name: "Mute", slug: "mute" }).success, true);
  assert.equal(familyCreateSchema.safeParse({ name: "Mute", slug: "Mute Guard" }).success, false);
  assert.equal(familyCreateSchema.parse({ name: "Mute", slug: "mute" }).channel, "shop");
});

test("an update must change something", () => {
  assert.equal(familyUpdateSchema.safeParse({}).success, false);
  assert.equal(familyUpdateSchema.safeParse({ active: false }).success, true);
});

test("update schemas strip unknown keys (admin PATCH whitelist)", () => {
  assert.deepEqual(familyUpdateSchema.parse({ active: false, id: "x" }), { active: false });
  assert.equal(familyUpdateSchema.safeParse({ id: "x" }).success, false);
});

test("option values are unique, case-insensitively", () => {
  assert.equal(optionCreateSchema.safeParse({ name: "Size", values: ["S", "M"] }).success, true);
  assert.equal(optionCreateSchema.safeParse({ name: "Size", values: ["S", "s"] }).success, false);
  assert.equal(optionCreateSchema.safeParse({ name: "Size", values: [] }).success, false);
});

test("prices are whole cents, zero allowed, never negative", () => {
  assert.equal(variantUpdateSchema.safeParse({ basePriceCents: 1999 }).success, true);
  assert.equal(variantUpdateSchema.safeParse({ basePriceCents: 19.99 }).success, false);
  assert.equal(variantUpdateSchema.safeParse({ basePriceCents: null }).success, true);
  assert.equal(clientPriceUpsertSchema.safeParse({ priceCents: 0 }).success, true);
  assert.equal(clientPriceUpsertSchema.safeParse({ priceCents: -1 }).success, false);
});

test("cart lines name a variant and a positive whole quantity", () => {
  assert.equal(cartLinesSchema.safeParse([{ variantId: "v1", qty: "2" }]).success, true);
  assert.equal(cartLinesSchema.safeParse([{ id: "16", qty: 1 }]).success, false);
  assert.equal(cartLinesSchema.safeParse([]).success, false);
});

test("checkout items are cart lines", () => {
  const base = {
    opaqueData: { dataDescriptor: "d", dataValue: "v" },
    email: "a@b.co",
    amount: 12,
    shipping: { name: "A", address1: "1 St", city: "C", state: "TX", postalCode: "75001" },
  };
  assert.equal(checkoutSchema.safeParse({ ...base, items: [{ variantId: "v1", qty: 1 }] }).success, true);
  assert.equal(checkoutSchema.safeParse({ ...base, items: [{ id: "16", qty: 1 }] }).success, false);
});

test("cart qty accepts numbers and numeric strings but not booleans, arrays, null or blanks", () => {
  const ok = (qty) => cartLinesSchema.safeParse([{ variantId: "v1", qty }]).success;
  assert.equal(ok(2), true);
  assert.equal(ok("2"), true);
  for (const bad of [true, false, [3], null, "", " ", "abc", 0, 1.5, "1.5"]) assert.equal(ok(bad), false, JSON.stringify(bad));
});
