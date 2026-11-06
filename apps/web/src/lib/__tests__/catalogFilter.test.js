import { test } from "vitest";
import assert from "node:assert/strict";
import { categoryCounts, inCategory, searchCatalog } from "../catalogFilter";
import { SEED_CATALOG } from "../../data/catalog";

const product = (id, name, categories, extra = {}) => ({
  id,
  name,
  categories,
  description: "",
  active: true,
  ...extra,
});

const PRODUCTS = [
  product("1", "Polishing Bur", ["Tools"]),
  product("2", "Sonic Cleaner", ["Tools", "Products"]),
  product("3", "Sleep Band", ["Sleep"], { description: "nylon strap" }),
  product("4", "Retired Item", ["Retired"], { active: false }),
];

const ids = (list) => list.map((p) => p.id);

test("search leaves out products not for sale and looks in the name and description", () => {
  assert.deepEqual(ids(searchCatalog(PRODUCTS, "")), ["1", "2", "3"]);
  assert.deepEqual(ids(searchCatalog(PRODUCTS, "  NYLON ")), ["3"]);
  assert.deepEqual(ids(searchCatalog(PRODUCTS, "retired")), []);
});

test("no category means every product", () => {
  assert.equal(inCategory(PRODUCTS, null).length, 4);
  assert.deepEqual(ids(inCategory(PRODUCTS, "Tools")), ["1", "2"]);
});

test("a category with nothing for sale is not offered", () => {
  const names = categoryCounts(PRODUCTS, searchCatalog(PRODUCTS, "")).map((c) => c.name);
  assert.deepEqual(names, ["Products", "Sleep", "Tools"]);
});

test("counts follow the search, and a category with no match stays listed at 0", () => {
  assert.deepEqual(categoryCounts(PRODUCTS, searchCatalog(PRODUCTS, "bur")), [
    { name: "Products", count: 0 },
    { name: "Sleep", count: 0 },
    { name: "Tools", count: 1 },
  ]);
});

test("the shop does not sell appliances made per case", () => {
  const forSale = ids(searchCatalog(SEED_CATALOG, ""));
  for (const id of ["70", "109", "112"]) assert.ok(!forSale.includes(id), id);
  assert.ok(forSale.includes("63"), "sample models stay");
});
