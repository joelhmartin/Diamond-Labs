import { test } from "vitest";
import assert from "node:assert/strict";
import { planCopy, diffEffective, previewHash, effectiveAfterPlan, stateAfterPlan } from "./price-copy.js";

const state = (overrides = {}, listIds = [], archivedListIds = []) => ({
  overrides: new Map(Object.entries(overrides)), listIds, archivedListIds: new Set(archivedListIds),
});
const lists = new Map([
  ["L1", { listId: "L1", name: "Gold", items: new Map([["v1", 900], ["v2", 800]]) }],
  ["L2", { listId: "L2", name: "Silver", items: new Map([["v3", 700]]) }],
]);
const sorted = (m) => [...m].sort(([a], [b]) => a.localeCompare(b));

test("replace makes the target's effective prices identical to the source's", () => {
  const source = state({ v1: 500, v4: 300 }, ["L1"]);
  const target = state({ v1: 450, v9: 100 }, ["L2"]);
  const plan = planCopy({ source, target, mode: "replace" });
  assert.deepEqual(plan.overrides.upsert, [{ variantId: "v1", cents: 500 }, { variantId: "v4", cents: 300 }]);
  assert.deepEqual(plan.overrides.remove, ["v9"]);
  assert.deepEqual(plan.listIds, ["L1"]);
  const afterTarget = effectiveAfterPlan(stateAfterPlan(target, plan), lists);
  assert.deepEqual(sorted(afterTarget), sorted(effectiveAfterPlan(source, lists)));
});

test("merge keeps target-only overrides and appends missing lists", () => {
  const source = state({ v1: 500 }, ["L1", "L2"]);
  const target = state({ v9: 100 }, ["L2"]);
  const plan = planCopy({ source, target, mode: "merge" });
  assert.deepEqual(plan.overrides.upsert, [{ variantId: "v1", cents: 500 }]);
  assert.deepEqual(plan.overrides.remove, []);
  assert.deepEqual(plan.listIds, ["L2", "L1"]);
  assert.equal(stateAfterPlan(target, plan).overrides.get("v9"), 100);
});

test("an override already equal on the target is not rewritten", () => {
  const plan = planCopy({ source: state({ v1: 500 }), target: state({ v1: 500 }), mode: "merge" });
  assert.deepEqual(plan.overrides.upsert, []);
});

test("an archived source list is not copied; a target's archived list is kept by merge, dropped by replace", () => {
  const source = state({}, ["L1", "L2"], ["L2"]);
  const target = state({}, ["L3"], ["L3"]);
  assert.deepEqual(planCopy({ source, target, mode: "merge" }).listIds, ["L3", "L1"]);
  assert.deepEqual(planCopy({ source, target, mode: "replace" }).listIds, ["L1"]);
});

test("diff lists only variants whose effective cents or source change", () => {
  const before = new Map([["v1", { cents: 100, source: "client" }], ["v2", { cents: 200, source: "list" }], ["v3", { cents: 300, source: "list" }]]);
  const after = new Map([["v1", { cents: 100, source: "client" }], ["v2", { cents: 200, source: "client" }], ["v3", { cents: 250, source: "list" }], ["v4", { cents: 50, source: "client" }]]);
  assert.deepEqual(diffEffective(before, after), [
    { variantId: "v2", beforeCents: 200, beforeSource: "list", afterCents: 200, afterSource: "client" },
    { variantId: "v3", beforeCents: 300, beforeSource: "list", afterCents: 250, afterSource: "list" },
    { variantId: "v4", beforeCents: null, beforeSource: "base", afterCents: 50, afterSource: "client" },
  ]);
  const gone = diffEffective(new Map([["v1", { cents: 1, source: "client" }]]), new Map());
  assert.deepEqual(gone, [{ variantId: "v1", beforeCents: 1, beforeSource: "client", afterCents: null, afterSource: "base" }]);
});

test("previewHash is stable across key order and changes with any plan edit", () => {
  const a = [{ clientUserId: "t1", plan: { overrides: { upsert: [{ variantId: "v1", cents: 5 }], remove: [] }, listIds: ["L1"] }, changes: [] }];
  const b = [{ changes: [], plan: { listIds: ["L1"], overrides: { remove: [], upsert: [{ cents: 5, variantId: "v1" }] } }, clientUserId: "t1" }];
  assert.equal(previewHash(a), previewHash(b));
  assert.match(previewHash(a), /^[0-9a-f]{64}$/);
  const c = structuredClone(a);
  c[0].plan.overrides.upsert[0].cents = 6;
  assert.notEqual(previewHash(a), previewHash(c));
});
