import { test } from "vitest";
import assert from "node:assert/strict";
import { FAMILY_SEED } from "./family-seed.js";
import { planCatalogImport, slugify } from "./plan-catalog.js";
import { DEVICE_ROWS } from "../../services/rx/catalog-map/devices.table.js";

test("every seeded code is a lab-confirmed device row", () => {
  const confirmed = new Set(DEVICE_ROWS.filter((r) => r.status === "confirmed").map((r) => r.code));
  for (const f of FAMILY_SEED) for (const v of f.variants) {
    assert.ok(confirmed.has(v.code), `${f.slug}: ${v.code} is not a confirmed DEVICE_ROWS code`);
  }
});

test("the seed is internally consistent", () => {
  const codes = FAMILY_SEED.flatMap((f) => f.variants.map((v) => v.code));
  assert.equal(new Set(codes).size, codes.length, "a code appears twice");
  for (const f of FAMILY_SEED) {
    const combos = new Set();
    for (const v of f.variants) {
      for (const o of f.options) assert.ok(v.values[o], `${f.slug} ${v.code} has no ${o}`);
      const key = f.options.map((o) => v.values[o]).join("|");
      assert.ok(!combos.has(key), `${f.slug} repeats ${key}`);
      combos.add(key);
    }
  }
});

const products = [
  { seazonaProductId: "p1", code: "2119", name: "OND Nylon", price: "450.00", taxable: false, catalogId: null, purchasable: false },
  { seazonaProductId: "p2", code: "2114", name: "OND PMT", price: "400.00", taxable: false, catalogId: null, purchasable: false },
  { seazonaProductId: "p3", code: "61", name: "Mute", price: "21.99", taxable: true, catalogId: "61", purchasable: true },
  { seazonaProductId: "p4", code: "2367", name: "Digital Model Fabrication", price: "35.00", taxable: false, catalogId: null, purchasable: false },
];
const familySeed = [{
  slug: "olmos-night", name: "Olmos Night", channel: "rx", options: ["Design", "Material"],
  variants: [
    { code: "2119", values: { Design: "ON-D Deprogrammer", Material: "Nylon" } },
    { code: "2114", values: { Design: "ON-D Deprogrammer", Material: "PMT" } },
    { code: "9999", values: { Design: "ON-D Deprogrammer", Material: "Gold" } },
  ],
}];
const shopSeed = [{ id: "61", name: "Mute", description: "Small / Medium / Large", image: "/catalog/mute.webp", categories: ["Sleep"], active: true }];

test("seeded families group their variants under real option values", () => {
  const { families, warnings } = planCatalogImport({ products, familySeed, shopSeed });
  const night = families.find((f) => f.slug === "olmos-night");
  assert.equal(night.variants.length, 2);
  assert.deepEqual(night.options, [
    { name: "Design", values: ["ON-D Deprogrammer"] },
    { name: "Material", values: ["Nylon", "PMT"] },
  ]);
  assert.equal(night.variants[0].basePriceCents, 45000);
  assert.equal(night.variants[0].legacySeazonaProductId, "p1");
  assert.ok(warnings.some((w) => w.includes("9999")));
});

test("everything else becomes a one-variant family; shop items keep their presentation", () => {
  const { families } = planCatalogImport({ products, familySeed, shopSeed });
  const mute = families.find((f) => f.name === "Mute");
  assert.equal(mute.channel, "shop");
  assert.equal(mute.imageUrl, "/catalog/mute.webp");
  assert.equal(mute.category, "Sleep");
  assert.deepEqual(mute.options, []);
  assert.equal(mute.variants[0].catalogId, "61");
  assert.equal(mute.variants[0].active, true);
  const lab = families.find((f) => f.name === "Digital Model Fabrication");
  assert.equal(lab.channel, "rx");
});

test("every product lands in exactly one family and slugs are unique", () => {
  const { families } = planCatalogImport({ products, familySeed, shopSeed });
  const legacy = families.flatMap((f) => f.variants.map((v) => v.legacySeazonaProductId));
  assert.deepEqual([...legacy].sort(), ["p1", "p2", "p3", "p4"]);
  const slugs = families.map((f) => f.slug);
  assert.equal(new Set(slugs).size, slugs.length);
});

test("a duplicate Seazona code imports its second product without a code", () => {
  const dup = [
    { seazonaProductId: "a", code: "7", name: "One", price: "1.00", taxable: false, catalogId: null, purchasable: false },
    { seazonaProductId: "b", code: "7", name: "Two", price: "2.00", taxable: false, catalogId: null, purchasable: false },
  ];
  const { families, warnings } = planCatalogImport({ products: dup, familySeed: [], shopSeed: [] });
  const codes = families.flatMap((f) => f.variants.map((v) => v.code));
  assert.deepEqual(codes, ["7", null]);
  assert.ok(warnings.some((w) => w.includes("reuses code 7")));
});

test("slugify makes url-safe slugs", () => {
  assert.equal(slugify("Diamond (PMT/Acrylic) Sample Models"), "diamond-pmt-acrylic-sample-models");
  assert.equal(slugify("  --  "), "item");
});
