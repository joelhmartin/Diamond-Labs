import { test, vi } from "vitest";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("../config/database.js", () => ({ db: {} }));

const { loadEffectiveClientPrices, loadClientPrices } = await import("./pricing.service.js");
const { presentShopFamily } = await import("../lib/catalog-variants.js");

const render = (chunk) => new PgDialect().sqlToQuery(chunk).sql;

/** A db whose awaited select chains pop queued results and record every builder call. */
function recordingDb(selects) {
  const chains = [];
  const db = {
    select: () => {
      const calls = [];
      chains.push(calls);
      const b = new Proxy(function () {}, {
        get(_t, prop) {
          if (prop === "then") return (res, rej) => Promise.resolve(selects.shift() ?? []).then(res, rej);
          return (...args) => { calls.push([prop, args]); return b; };
        },
      });
      return b;
    },
  };
  return { db, chains };
}
const callOf = (calls, name) => calls.find(([m]) => m === name)?.[1];

test("an archived list is skipped in resolution", async () => {
  // The assignment query only returns non-archived lists; L-arch is assigned but archived, so the DB leaves it out.
  const { db, chains } = recordingDb([
    [],                                                          // overrides
    [{ listId: "L2", name: "Standard", position: 1 }],           // assignments (archived L1 filtered by the query)
    [{ listId: "L2", variantId: "a", priceCents: 900 }],         // items for L2 only
  ]);
  const out = await loadEffectiveClientPrices("u1", ["a"], db);
  const where = render(callOf(chains[1], "where")[0]);
  assert.match(where, /"price_lists"\."archived_at" is null/);
  assert.match(where, /"client_price_lists"\."client_user_id" = \$1/);
  assert.match(render(callOf(chains[1], "orderBy")[0]), /"client_price_lists"\."position"/);
  assert.match(render(callOf(chains[2], "where")[0]), /"price_list_items"\."price_list_id" in \(\$1\)/);
  assert.deepEqual(out.get("a"), { cents: 900, source: "list", listId: "L2", listName: "Standard" });
});

test("no assigned lists: two queries, overrides only", async () => {
  const { db, chains } = recordingDb([[{ variantId: "a", priceCents: 1500 }], []]);
  const out = await loadEffectiveClientPrices("u1", ["a", "b"], db);
  assert.equal(chains.length, 2);
  assert.deepEqual(out.get("a"), { cents: 1500, source: "client", listId: null, listName: null });
  assert.equal(out.has("b"), false);
});

test("null variantIds loads every variant; an empty list loads nothing", async () => {
  const all = recordingDb([[{ variantId: "a", priceCents: 1 }], []]);
  await loadEffectiveClientPrices("u1", null, all.db);
  assert.doesNotMatch(render(callOf(all.chains[0], "where")[0]), / in \(/);
  const none = recordingDb([]);
  assert.equal((await loadEffectiveClientPrices("u1", [], none.db)).size, 0);
  assert.equal(none.chains.length, 0);
  assert.equal((await loadEffectiveClientPrices(null, ["a"], none.db)).size, 0);
});

test("loadClientPrices keeps its callers' contract", async () => {
  const { db } = recordingDb([
    [{ variantId: "a", priceCents: 1500 }],
    [{ listId: "L1", name: "Standard", position: 0 }],
    [{ listId: "L1", variantId: "a", priceCents: 1200 }, { listId: "L1", variantId: "b", priceCents: 300 }],
  ]);
  const prices = await loadClientPrices("u1", ["a", "b", "c"], db);
  assert.deepEqual([...prices.entries()], [["a", { cents: 1500, source: "client" }], ["b", { cents: 300, source: "list" }]]);
  // catalog-variants still prices from the wrapper's Map.
  const family = presentShopFamily({
    id: "f", slug: "f", name: "F", description: null, category: null, imageUrl: null, options: [],
    variants: ["a", "b", "c"].map((id) => ({ id, code: id, name: id, optionValueIds: [], active: true, basePriceCents: 1000, taxable: false })),
  }, prices);
  assert.deepEqual(family.variants.map((v) => [v.id, v.priceCents, v.priceSource]), [["a", 1500, "client"], ["b", 300, "list"], ["c", 1000, "base"]]);
});
