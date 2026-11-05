import { test } from "vitest";
import assert from "node:assert/strict";
import { pricingSignature, groupBySignature } from "./same-pricing.js";

const eff = (pairs, source = "client") => new Map(pairs.map(([v, cents]) => [v, { cents, source }]));

test("an empty map is the base signature", () => {
  assert.equal(pricingSignature(new Map()), "base");
});

test("signature ignores source and insertion order", () => {
  const a = pricingSignature(eff([["v1", 500], ["v2", 700]], "client"));
  const b = pricingSignature(new Map([["v2", { cents: 700, source: "list" }], ["v1", { cents: 500, source: "list" }]]));
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{40}$/);
  assert.notEqual(a, pricingSignature(eff([["v1", 501], ["v2", 700]])));
});

test("groups sort by size desc and collect lists and override counts", () => {
  const groups = groupBySignature([
    { id: "a", effective: eff([["v1", 5]]), listNames: ["Gold"], overrideCount: 1 },
    { id: "b", effective: eff([["v1", 5]]), listNames: ["Gold", "Silver"], overrideCount: 2 },
    { id: "c", effective: new Map(), listNames: [], overrideCount: 0 },
    { id: "d", effective: new Map(), listNames: [], overrideCount: 0 },
    { id: "e", effective: new Map(), listNames: [], overrideCount: 0 },
  ]);
  assert.deepEqual(groups.map((g) => [g.signature === "base", g.size]), [[true, 3], [false, 2]]);
  assert.deepEqual(groups[1].clientIds, ["a", "b"]);
  assert.deepEqual(groups[1].lists, ["Gold", "Silver"]);
  assert.equal(groups[1].overrideCount, 3);
});
