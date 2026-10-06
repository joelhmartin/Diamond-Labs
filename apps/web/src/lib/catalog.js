// Shop-side view of GET /catalog families. Prices arrive in cents and are
// display-only: checkout charges the server quote.

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

export function familyToProduct(family) {
  const prices = family.variants.map((v) => v.priceCents);
  return {
    id: family.id,
    name: family.name,
    description: family.description ?? "",
    image: family.imageUrl ?? null,
    thumbnail: family.imageUrl ?? null,
    categories: family.category ? [family.category] : [],
    availability: "in-stock",
    active: true,
    priceFromCents: Math.min(...prices),
    singleVariant: family.variants.length === 1 ? family.variants[0] : null,
    family,
  };
}

export function variantFor(family, selectedValueIds) {
  return family.variants.find((v) => sameSet(v.optionValueIds, selectedValueIds)) ?? null;
}

export function variantLabel(family, variant) {
  const labelOf = new Map(family.options.flatMap((o) => o.values.map((v) => [v.id, v.value])));
  const parts = variant.optionValueIds.map((id) => labelOf.get(id)).filter(Boolean);
  return parts.length ? `${family.name} — ${parts.join(" · ")}` : family.name;
}

export function cartItemFor(family, variant) {
  return {
    id: variant.id,
    variantId: variant.id,
    name: variantLabel(family, variant),
    price: variant.priceCents / 100,
    image: family.imageUrl ?? null,
  };
}

/** zustand persist migrate: pre-variant carts held shop SKU ids, which checkout now refuses. */
export function migrateCart(persisted) {
  const items = (persisted?.items ?? []).filter((i) => i.variantId);
  return { ...persisted, items };
}
