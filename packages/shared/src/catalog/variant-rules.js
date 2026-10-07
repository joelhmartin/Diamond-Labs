// Catalog deletion rules — shared so the admin UI offers delete exactly when the
// API will accept it. There are no DB foreign keys, so a delete must never
// orphan a client's negotiated price or an order line that points at a variant.

/**
 * May this variant be deleted (or replaced by a merge)? Only a blank grid
 * placeholder qualifies: inactive, unpriced, no lab code, no client prices,
 * never sold. `familyVariantCount` (optional) refuses removing a family's
 * last variant — deactivate the product instead.
 * -> { ok: true } | { ok: false, reason }
 */
export function canDeleteVariant({ variant, clientPriceCount = 0, orderItemCount = 0, familyVariantCount = null }) {
  if (variant.active) return { ok: false, reason: "It is active. Deactivate it first." };
  if (variant.basePriceCents != null) return { ok: false, reason: "It has a base price. Clear the price first." };
  if (variant.code != null && variant.code !== "") return { ok: false, reason: "It has a lab code, so invoices may refer to it." };
  if (clientPriceCount > 0) return { ok: false, reason: `${clientPriceCount} client price${clientPriceCount === 1 ? " uses" : "s use"} it.` };
  if (orderItemCount > 0) return { ok: false, reason: "It appears on past orders." };
  if (familyVariantCount === 1) return { ok: false, reason: "It is the product's only variant. Deactivate the product instead." };
  return { ok: true };
}

/**
 * May this option value be deleted? Never the option's last value; otherwise
 * only when every variant using it is deletable (they go with it).
 * `variants` are the variants carrying this value, each with usage counts.
 */
export function canDeleteOptionValue({ optionValueCount, variants }) {
  if (optionValueCount <= 1) return { ok: false, reason: "It is the option's only value." };
  for (const v of variants) {
    const r = canDeleteVariant({ variant: v, clientPriceCount: v.clientPriceCount, orderItemCount: v.orderItemCount });
    if (!r.ok) return { ok: false, reason: `${v.name}: ${r.reason}` };
  }
  return { ok: true };
}
