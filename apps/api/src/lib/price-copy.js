import { createHash } from "node:crypto";
import { resolveClientPrices } from "./pricing.js";

// Copy prices between clients (spec R3). Pure: the service loads each client's
// state and applies the plan. Effective prices always come from
// resolveClientPrices (lib/pricing.js), never a second resolver.
//
// state = { overrides: Map<variantId, cents>, listIds: string[] (assignment order),
//           archivedListIds?: Set<string> }

const live = (state) => state.listIds.filter((id) => !state.archivedListIds?.has(id));

/**
 * replace: the target ends up with the source's live lists and exactly the source's overrides
 * (target-only overrides are removed). merge: the source's overrides are set, the target's other
 * overrides stay and the source's live lists the target lacks are appended. Archived lists never
 * travel (they do not apply, and cannot be newly assigned).
 */
export function planCopy({ source, target, mode }) {
  const upsert = [...source.overrides]
    .filter(([variantId, cents]) => target.overrides.get(variantId) !== cents)
    .map(([variantId, cents]) => ({ variantId, cents }))
    .sort((a, b) => a.variantId.localeCompare(b.variantId));
  if (mode === "replace") {
    const remove = [...target.overrides.keys()].filter((v) => !source.overrides.has(v)).sort();
    return { overrides: { upsert, remove }, listIds: live(source) };
  }
  const have = new Set(target.listIds);
  return { overrides: { upsert, remove: [] }, listIds: [...target.listIds, ...live(source).filter((id) => !have.has(id))] };
}

/** The state a plan produces on a target (the planner's inputs, applied). */
export function stateAfterPlan(target, plan) {
  const overrides = new Map(target.overrides);
  for (const v of plan.overrides.remove) overrides.delete(v);
  for (const { variantId, cents } of plan.overrides.upsert) overrides.set(variantId, cents);
  return { overrides, listIds: plan.listIds, archivedListIds: target.archivedListIds ?? new Set() };
}

/** Effective prices for a state. `listsById`: Map<listId, { listId, name, items: Map }>. */
export function effectiveAfterPlan(state, listsById) {
  const lists = live(state).map((id) => listsById.get(id)).filter(Boolean);
  return resolveClientPrices({ overrides: state.overrides, lists });
}

/** Variants whose effective cents or source differ. A missing entry is the base price (null cents). */
export function diffEffective(beforeMap, afterMap) {
  const out = [];
  for (const variantId of new Set([...beforeMap.keys(), ...afterMap.keys()])) {
    const b = beforeMap.get(variantId);
    const a = afterMap.get(variantId);
    if ((b?.cents ?? null) === (a?.cents ?? null) && (b?.source ?? "base") === (a?.source ?? "base")) continue;
    out.push({
      variantId,
      beforeCents: b?.cents ?? null, beforeSource: b?.source ?? "base",
      afterCents: a?.cents ?? null, afterSource: a?.source ?? "base",
    });
  }
  return out.sort((x, y) => x.variantId.localeCompare(y.variantId));
}

const canonical = (v) => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
};

/** sha256 of the canonical JSON of every target's plan (and its diff), in target-id order. */
export function previewHash(plans) {
  const sorted = [...plans].sort((a, b) => a.clientUserId.localeCompare(b.clientUserId));
  return createHash("sha256").update(canonical(sorted)).digest("hex");
}
