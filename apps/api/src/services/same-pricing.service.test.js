import { test, vi } from "vitest";
import assert from "node:assert/strict";
import { fakeTx } from "../test/fake-tx.js";

vi.mock("../config/database.js", () => ({ db: {} }));

const { sameClientPricingGroups } = await import("./same-pricing.service.js");

const U = (id, name) => ({ id, name, email: `${id}@x.test`, accountNumber: `A${id}` });
// Select order: users, overrides, assignments, list items, practices.
const loaded = ({ users, overrides = [], assigned = [], items = [], practices = [] }) => [users, overrides, assigned, items, practices];
const GOLD = { listId: "L1", name: "Gold", archivedAt: null, position: 0 };
const GOLD_ITEMS = [{ listId: "L1", variantId: "v1", priceCents: 500 }];

test("two clients on the same list with no overrides group together", async () => {
  const tx = fakeTx({ selects: loaded({
    users: [U("a", "Ann"), U("b", "Bo"), U("c", "Cy")],
    assigned: [{ clientUserId: "a", ...GOLD }, { clientUserId: "b", ...GOLD }],
    items: GOLD_ITEMS,
  }) });
  const { groups } = await sameClientPricingGroups(tx);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].size, 2);
  assert.deepEqual(groups[0].clients.map((c) => c.id), ["a", "b"]);
  assert.deepEqual(groups[0].lists, ["Gold"]);
});

test("an override equal to the list price does not split the group", async () => {
  const tx = fakeTx({ selects: loaded({
    users: [U("a", "Ann"), U("b", "Bo")],
    overrides: [{ clientUserId: "b", variantId: "v1", priceCents: 500 }],
    assigned: [{ clientUserId: "a", ...GOLD }, { clientUserId: "b", ...GOLD }],
    items: GOLD_ITEMS,
  }) });
  const { groups } = await sameClientPricingGroups(tx);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].size, 2);
  assert.equal(groups[0].overrideCount, 1);
});

test("clients with nothing beyond base share the base group, archived lists included", async () => {
  const tx = fakeTx({ selects: loaded({
    users: [U("a", "Ann"), U("b", "Bo")],
    assigned: [{ clientUserId: "b", ...GOLD, archivedAt: new Date() }],
    items: [],
  }) });
  const { groups } = await sameClientPricingGroups(tx);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].signature, "base");
  assert.deepEqual(groups[0].lists, []);
});

test("singles are excluded unless includeSingles", async () => {
  const sel = () => loaded({
    users: [U("a", "Ann"), U("b", "Bo"), U("c", "Cy")],
    overrides: [{ clientUserId: "c", variantId: "v9", priceCents: 1 }],
  });
  assert.equal((await sameClientPricingGroups(fakeTx({ selects: sel() }))).groups.length, 1);
  assert.equal((await sameClientPricingGroups(fakeTx({ selects: sel() }), { includeSingles: true })).groups.length, 2);
});

test("the service runs a fixed number of queries regardless of client count", async () => {
  const count = async (n) => {
    const users = Array.from({ length: n }, (_, i) => U(`u${i}`, `N${i}`));
    const tx = fakeTx({ selects: loaded({
      users,
      overrides: users.map((u, i) => ({ clientUserId: u.id, variantId: "v1", priceCents: i })),
      assigned: users.map((u) => ({ clientUserId: u.id, ...GOLD })),
      items: GOLD_ITEMS,
    }) });
    await sameClientPricingGroups(tx);
    return tx.log.filter((l) => l.op === "select").length;
  };
  assert.equal(await count(2), await count(40));
});
