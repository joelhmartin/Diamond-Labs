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
    priceFromCents: prices.length ? Math.min(...prices) : null,
    singleVariant: family.variants.length === 1 ? family.variants[0] : null,
    family,
  };
}

/**
 * Who prices are being fetched for. null while the silent refresh is still
 * deciding (a fetch now would go out tokenless and come back at guest prices);
 * then the user's id, or "guest". Part of every price fetch's key so a login,
 * logout or expired session re-prices.
 */
export function shopperIdentity({ isLoading, user }) {
  if (isLoading) return null;
  return user?.id ?? "guest";
}

/** The key a quote is cached under: the shopper and the cart lines. */
export function quoteKey(items, identity, nonce = 0) {
  return JSON.stringify([identity, nonce, items.map((i) => [i.variantId, i.qty])]);
}

/** The server-priced line for a cart item, or null while pricing. */
export function quoteLineFor(quote, variantId) {
  return quote?.lines.find((l) => l.variantId === variantId) ?? null;
}

/** A quote only counts for the cart it was priced from; otherwise treat it as "still pricing". */
export function currentQuote(state, key) {
  return state && state.key === key ? state.quote : null;
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
    // No price: cart and checkout show the server quote, never an add-time copy.
    image: family.imageUrl ?? null,
  };
}

/** zustand persist migrate: pre-variant carts held shop SKU ids, which checkout now refuses. */
export function migrateCart(persisted) {
  const items = (persisted?.items ?? []).filter((i) => i.variantId);
  return { ...persisted, items };
}
