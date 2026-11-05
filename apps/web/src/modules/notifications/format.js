/** "Nov 5, 3:04 PM" in `timeZone` (an IANA name; omit for the browser's own). */
export function formatWhen(iso, timeZone) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...(timeZone ? { timeZone } : {}) });
}

/** Title with the burst count when an alert collapsed several: "Order shipped (3)". */
export const alertTitle = (n) => (n.count > 1 ? `${n.title} (${n.count})` : n.title);
