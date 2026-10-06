import { unitPriceFor } from "./pricing.js";

// Variant-grid rules. Pure — services/catalog.service.js does the DB work.

/** Every way to pick one value from each option, in option order. */
export function combinations(options) {
  return options.reduce(
    (acc, opt) => acc.flatMap((prefix) => opt.values.map((v) => [...prefix, v.id])),
    [[]],
  );
}

export const comboKey = (ids) => [...ids].sort().join("|");

export function missingCombinations(options, variants) {
  const have = new Set(variants.map((v) => comboKey(v.optionValueIds)));
  return combinations(options).filter((c) => !have.has(comboKey(c)));
}

export function validateCombination(options, optionValueIds) {
  const optionOf = new Map();
  for (const o of options) for (const v of o.values) optionOf.set(v.id, o.id);
  const seen = new Set();
  for (const id of optionValueIds) {
    const o = optionOf.get(id);
    if (!o) return { ok: false, reason: `Unknown option value ${id}.` };
    if (seen.has(o)) return { ok: false, reason: "Two values were picked for the same option." };
    seen.add(o);
  }
  if (seen.size !== options.length) return { ok: false, reason: "Every option needs a value." };
  return { ok: true };
}

export function findDuplicateCombination(variants, optionValueIds, exceptVariantId = null) {
  const key = comboKey(optionValueIds);
  return variants.find((v) => v.id !== exceptVariantId && comboKey(v.optionValueIds) === key) ?? null;
}

const byPosition = (a, b) => a.position - b.position;

export function shapeFamily({ family, options, values, variants, links }) {
  const valuesByOption = new Map();
  for (const v of [...values].sort(byPosition)) {
    if (!valuesByOption.has(v.optionId)) valuesByOption.set(v.optionId, []);
    valuesByOption.get(v.optionId).push({ id: v.id, value: v.value, position: v.position });
  }
  const valueIdsByVariant = new Map();
  for (const l of links) {
    if (!valueIdsByVariant.has(l.variantId)) valueIdsByVariant.set(l.variantId, []);
    valueIdsByVariant.get(l.variantId).push(l.optionValueId);
  }
  return {
    ...family,
    options: [...options].sort(byPosition).map((o) => ({
      id: o.id, name: o.name, position: o.position, values: valuesByOption.get(o.id) ?? [],
    })),
    variants: variants.map((v) => ({ ...v, optionValueIds: valueIdsByVariant.get(v.id) ?? [] })),
  };
}

/** What the public shop may see of a family. null = nothing sellable. */
export function presentShopFamily(shaped, clientPrices) {
  const variants = [];
  for (const v of shaped.variants) {
    if (!v.active) continue;
    const price = unitPriceFor(v, clientPrices.get(v.id));
    if (!price) continue;
    variants.push({
      id: v.id, code: v.code, name: v.name, optionValueIds: v.optionValueIds,
      priceCents: price.cents, priceSource: price.source, taxable: v.taxable,
    });
  }
  if (variants.length === 0) return null;
  const { id, slug, name, description, category, imageUrl, options } = shaped;
  return { id, slug, name, description, category, imageUrl, options, variants };
}
