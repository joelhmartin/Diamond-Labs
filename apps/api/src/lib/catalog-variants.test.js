import { test } from "vitest";
import assert from "node:assert/strict";
import {
  combinations, missingCombinations, validateCombination,
  findDuplicateCombination, shapeFamily, presentShopFamily,
} from "./catalog-variants.js";

const design = { id: "d", values: [{ id: "d1" }, { id: "d2" }] };
const material = { id: "m", values: [{ id: "m1" }, { id: "m2" }, { id: "m3" }] };

test("combinations is the cartesian product, one value per option", () => {
  assert.deepEqual(combinations([]), [[]]);
  assert.equal(combinations([design, material]).length, 6);
  assert.deepEqual(combinations([design]), [["d1"], ["d2"]]);
  assert.deepEqual(combinations([{ id: "x", values: [] }]), []);
});

test("missingCombinations ignores value order", () => {
  const have = [{ optionValueIds: ["m1", "d1"] }];
  const missing = missingCombinations([design, material], have);
  assert.equal(missing.length, 5);
  assert.ok(!missing.some((c) => c.includes("d1") && c.includes("m1")));
});

test("a variant picks exactly one value from every option", () => {
  assert.deepEqual(validateCombination([design, material], ["d1", "m2"]), { ok: true });
  assert.equal(validateCombination([design, material], ["d1"]).ok, false);
  assert.equal(validateCombination([design, material], ["d1", "d2"]).ok, false);
  assert.equal(validateCombination([design, material], ["d1", "zz"]).ok, false);
  assert.deepEqual(validateCombination([], []), { ok: true });
});

test("duplicate combinations are found, except against the variant itself", () => {
  const variants = [{ id: "v1", optionValueIds: ["d1", "m1"] }];
  assert.equal(findDuplicateCombination(variants, ["m1", "d1"])?.id, "v1");
  assert.equal(findDuplicateCombination(variants, ["m1", "d1"], "v1"), null);
});

const shaped = shapeFamily({
  family: { id: "f", slug: "f", name: "Fam", description: null, category: null, imageUrl: null, channel: "shop", active: true, position: 0 },
  options: [{ id: "m", familyId: "f", name: "Material", position: 0 }],
  values: [{ id: "m2", optionId: "m", value: "PMT", position: 1 }, { id: "m1", optionId: "m", value: "Nylon", position: 0 }],
  variants: [
    { id: "v1", familyId: "f", code: "1", name: "Fam Nylon", basePriceCents: 1000, taxable: false, active: true },
    { id: "v2", familyId: "f", code: "2", name: "Fam PMT", basePriceCents: null, taxable: false, active: true },
    { id: "v3", familyId: "f", code: "3", name: "Fam Old", basePriceCents: 900, taxable: false, active: false },
  ],
  links: [{ variantId: "v1", optionValueId: "m1" }, { variantId: "v2", optionValueId: "m2" }],
});

test("shapeFamily nests values in position order and attaches each variant's values", () => {
  assert.deepEqual(shaped.options[0].values.map((v) => v.value), ["Nylon", "PMT"]);
  assert.deepEqual(shaped.variants.find((v) => v.id === "v1").optionValueIds, ["m1"]);
  assert.deepEqual(shaped.variants.find((v) => v.id === "v3").optionValueIds, []);
});

test("the shop sees only active, priced variants — with the client's price", () => {
  const pub = presentShopFamily(shaped, new Map([["v1", 800]]));
  assert.deepEqual(pub.variants.map((v) => v.id), ["v1"]);
  assert.equal(pub.variants[0].priceCents, 800);
  assert.equal(pub.variants[0].priceSource, "client");
});

test("a family with nothing sellable is hidden", () => {
  const empty = { ...shaped, variants: shaped.variants.filter((v) => v.id !== "v1") };
  assert.equal(presentShopFamily(empty, new Map()), null);
});
