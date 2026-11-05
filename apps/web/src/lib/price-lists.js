/** Pure helpers for price list screens. Money is integer cents. */

/**
 * `cents` moved by `pct` percent, rounded half away from zero to the cent and
 * never below zero. The percent may be fractional (12.5).
 */
export function adjustByPercent(cents, pct) {
  const exact = Number(((cents * (100 + pct)) / 100).toFixed(6)); // strip float noise before rounding
  const rounded = Math.sign(exact) * Math.round(Math.abs(exact));
  return Math.max(0, rounded);
}

/** "−10%" / "+5%" of a price against its base; empty when equal or no base to compare to. */
export function priceDelta(priceCents, basePriceCents) {
  if (basePriceCents == null || basePriceCents === 0 || priceCents === basePriceCents) return "";
  const pct = Math.round(((priceCents - basePriceCents) / basePriceCents) * 100);
  return pct < 0 ? `−${Math.abs(pct)}%` : `+${pct}%`;
}

/** Chip for a resolved price: `{ source: "client"|"list", listName }`, or null/undefined for base. */
export function sourceChip(effective) {
  if (effective?.source === "list") return { label: `List: ${effective.listName ?? "unnamed"}`, tone: "list" };
  if (effective?.source === "client") return { label: "Client", tone: "client" };
  return { label: "Base", tone: "base" };
}
