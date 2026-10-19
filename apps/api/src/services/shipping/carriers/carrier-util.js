import { toCents } from "@my-app/shared";

/**
 * Carrier-agnostic helpers shared by every carrier's request builders and
 * response parsers. Nothing carrier-specific belongs here.
 */

/** Trim and truncate to a carrier's field length; undefined when empty so the field is left out. */
export const cut = (s, n) => (s == null ? undefined : String(s).trim().slice(0, n) || undefined);

/** Digits only (phone numbers), at most `max`; undefined when none. */
export const digits = (s, max = 15) => String(s ?? "").replace(/\D/g, "").slice(0, max) || undefined;

/** A carrier's dollar amount ("11.42") → integer cents, once; null when unreadable. */
export function dollarsToCents(v) {
  try {
    return toCents(v);
  } catch {
    return null;
  }
}

/** A tracking result with nothing known yet (also the base of a per-number error result). */
export const emptyTrackResult = (trackingNumber) => ({
  trackingNumber, status: null, carrierCode: null, description: null, location: null, occurredAt: null, deliveredAt: null, events: [],
});

/** The API's one-item-object-instead-of-array quirk: always a list. */
export const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/**
 * Does a carrier's void answer mean "this label was already voided/cancelled"?
 * Strict on purpose: it needs "already [been] voided/cancelled" side by side, and any
 * hint of a refusal (cannot, not allowed, unable, tendered, picked up, in transit)
 * wins, so "already tendered, cannot cancel" or a mixed message stays a refusal.
 */
export function isAlreadyVoidedAnswer(code, message) {
  const text = `${code ?? ""} ${message ?? ""}`;
  if (/CANNOT|CAN'?T|NOT[._\s-]*ALLOWED|UNABLE|TENDERED|PICKED|PICK[._\s-]*UP|IN[._\s-]*TRANSIT/i.test(text)) return false;
  return /ALREADY[._\s-]*(BEEN[._\s-]*)?(CANCEL|VOID)/i.test(text);
}
