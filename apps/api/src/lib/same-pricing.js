import { createHash } from "node:crypto";

// Pure grouping for the same-pricing view. The effective map comes from the one
// resolver (lib/pricing.js resolveClientPrices); this only compares outcomes.

/** sha1 of the sorted `variantId:cents` pairs. Source is ignored: same cents is same pricing. Nothing beyond base = "base". */
export function pricingSignature(effective) {
  if (effective.size === 0) return "base";
  const pairs = [...effective].map(([variantId, { cents }]) => `${variantId}:${cents}`).sort();
  return createHash("sha1").update(pairs.join("|")).digest("hex");
}

/**
 * clients: [{ id, effective, listNames, overrideCount }]
 * -> [{ signature, size, clientIds, lists, overrideCount }] biggest group first.
 * `lists` is the union of the members' list names; `overrideCount` totals the members' overrides.
 */
export function groupBySignature(clients) {
  const groups = new Map();
  for (const c of clients) {
    const signature = pricingSignature(c.effective);
    let g = groups.get(signature);
    if (!g) groups.set(signature, (g = { signature, size: 0, clientIds: [], lists: [], overrideCount: 0 }));
    g.size += 1;
    g.clientIds.push(c.id);
    for (const n of c.listNames) if (!g.lists.includes(n)) g.lists.push(n);
    g.overrideCount += c.overrideCount;
  }
  return [...groups.values()].sort((a, b) => b.size - a.size);
}
