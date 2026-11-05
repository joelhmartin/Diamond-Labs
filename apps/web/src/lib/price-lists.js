/** Pure helpers for price list screens. Money is integer cents. */
import { pctOfCents } from "@my-app/shared";

/**
 * `cents` moved by `pct` percent: the shared pctOfCents of (100 + pct)% in basis
 * points, so half a cent rounds away from zero; never below zero. The percent may
 * be fractional (12.5); its resolution is a basis point (0.01%).
 */
export function adjustByPercent(cents, pct) {
  return Math.max(0, pctOfCents(cents, Math.round((100 + pct) * 100)));
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
