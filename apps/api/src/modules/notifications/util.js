import { maskAddress } from "./data-guard.js";

/** Bad input to a notifier method a route exposes (unknown event, invalid address, duplicate). */
export class NotificationInputError extends Error {
  constructor(message, code = "invalid") {
    super(message);
    this.name = "NotificationInputError";
    this.code = code;
  }
}

export const zero = () => ({ inApp: 0, sent: 0, skipped: 0, failed: 0 });

export const clip = (s, n) => {
  const v = String(s ?? "");
  return v.length > n ? v.slice(0, n) : v;
};

/** The in-app collapse key: one unread row per user per event and record. */
export const collapseKeyFor = (event, recordType, recordId) => clip(`${event}:${recordType ?? ""}:${recordId ?? ""}`, 200);

export const uniq = (xs) => [...new Set((xs ?? []).filter(Boolean))];

export const clampInt = (v, min, max, dflt) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

/**
 * An error message as it may appear in a log line or the deliveries table:
 * the target and anything shaped like an address or phone number masked.
 */
export function safeReason(err, target) {
  let msg = String(err?.message ?? err ?? "error");
  if (target) msg = msg.split(String(target)).join(maskAddress(target));
  msg = msg.replace(/[^\s@<>"']+@[^\s@<>"']+/g, (m) => maskAddress(m)).replace(/\+?\d[\d\s().-]{6,}\d/g, (m) => maskAddress(m));
  return clip(msg.replace(/\s+/g, " "), 200);
}
