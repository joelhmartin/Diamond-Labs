import { test, vi } from "vitest";
import assert from "node:assert/strict";

vi.mock("../config/database.js", () => ({ db: {} }));

const { effectiveForClient } = await import("./client-prices.service.js");

/** A db whose awaited select chains pop queued results. */
function queuedDb(selects) {
  const chain = () => new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === "then") return (res, rej) => Promise.resolve(selects.shift() ?? []).then(res, rej);
      return () => chain();
    },
  });
  return { select: () => chain() };
}

test("effective lists every non-base price with its source and list name, sorted like the page", async () => {
  const database = queuedDb([
    [{ variantId: "v2", priceCents: 1500 }],                                 // overrides
    [{ listId: "L1", name: "Standard", position: 0 }],                       // assigned lists
    [{ listId: "L1", variantId: "v1", priceCents: 900 }, { listId: "L1", variantId: "v2", priceCents: 800 }],
    [                                                                         // variants
      { variantId: "v1", variantName: "Night guard", variantCode: "61", basePriceCents: 1000, familyName: "Guards" },
      { variantId: "v2", variantName: "Aligner", variantCode: "70", basePriceCents: 2000, familyName: "Aligners" },
    ],
  ]);
  const out = await effectiveForClient("c1", database);
  assert.deepEqual(out.map((r) => [r.variantId, r.cents, r.source, r.listName, r.familyName]), [
    ["v2", 1500, "client", null, "Aligners"],
    ["v1", 900, "list", "Standard", "Guards"],
  ]);
});

test("the resolution also gives what the lists alone would charge, ignoring overrides", async () => {
  const { loadClientPriceResolution } = await import("./pricing.service.js");
  const { effective, listOnly } = await loadClientPriceResolution("c1", null, queuedDb([
    [{ variantId: "v1", priceCents: 700 }],
    [{ listId: "L1", name: "Standard", position: 0 }],
    [{ listId: "L1", variantId: "v1", priceCents: 900 }],
  ]));
  assert.equal(effective.get("v1").cents, 700);
  assert.equal(effective.get("v1").source, "client");
  assert.equal(listOnly.get("v1").cents, 900);
  assert.equal(listOnly.get("v1").source, "list");
});

test("a client with no overrides or lists has no effective prices", async () => {
  assert.deepEqual(await effectiveForClient("c1", queuedDb([[], []])), []);
});
