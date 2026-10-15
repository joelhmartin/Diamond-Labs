import { invoiceStatusLabel, isoDateIn, LAB_TIMEZONE, parseMoneyInput, formatUsDate, formatLabDate } from "@my-app/shared";

/** The lab's today, "YYYY-MM-DD": what "past due" is measured against. */
export const labToday = (now = new Date()) => isoDateIn(LAB_TIMEZONE, now);

export const STATUS_TONES = {
  Draft: "bg-gray-100 text-gray-700",
  Open: "bg-blue-500/10 text-blue-700",
  "Past due": "bg-red-500/10 text-red-700",
  Paid: "bg-emerald-500/10 text-emerald-700",
  Void: "bg-gray-200 text-gray-500",
};

export const statusOf = (inv, todayIso = labToday()) => invoiceStatusLabel(inv, todayIso);
export const isPayable = (inv) => inv.status === "issued" && inv.balanceCents > 0;

export const dateText = (iso) => formatUsDate(iso) || "—";
export const instantText = (instant) => formatLabDate(instant) || "—";
/** A ledger date ("YYYY-MM-DD", already lab-local) or a timestamp, as the lab's calendar day. */
export const dayText = (d) => (d && String(d).length > 10 ? instantText(d) : dateText(d));

export const ENTRY_LABELS = { payment: "Payment", credit: "Credit", refund: "Refund" };

/** Cents from what a person typed in an amount box; 0 for blank, junk or negative ("12." counts as 12). */
export function typedCents(str) {
  const c = parseMoneyInput(String(str ?? "").replace(/\.$/, ""));
  return Number.isSafeInteger(c) && c > 0 ? c : 0;
}

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** The `count` most recent months, newest first: [{ value: "YYYY-MM", label: "October 2026" }]. */
export function recentMonths(todayIso, count = 12) {
  const [y, m] = todayIso.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return { value: d.toISOString().slice(0, 7), label: MONTH_LABEL.format(d) };
  });
}

/**
 * The refund modal's per-invoice lines ([{ invoiceId, maxCents, include, amountStr }])
 * → what to send. Full reversal when every line is included at its full amount;
 * otherwise the included slices, each no more than was charged.
 */
export function refundSelection(lines) {
  const parsed = lines.map((l) => {
    const cents = typedCents(l.amountStr);
    return { ...l, cents, valid: !l.include || (cents > 0 && cents <= l.maxCents) };
  });
  const included = parsed.filter((l) => l.include);
  return {
    parsed,
    anySelected: included.length > 0,
    allValid: parsed.every((l) => l.valid),
    isFull: parsed.length > 0 && parsed.every((l) => l.include && l.cents === l.maxCents),
    totalCents: included.reduce((s, l) => s + l.cents, 0),
    allocations: included.map((l) => ({ invoiceId: l.invoiceId, amountCents: l.cents })),
  };
}

const ACTIVITY_WORDS = {
  "invoice.drafted": "Draft created",
  "invoice.edited": "Edited",
  "invoice.issued": "Issued",
  "invoice.issue_held": "Held at draft (needs a price)",
  "invoice.voided": "Voided",
  "invoice.credited": "Credit applied",
  "invoice.emailed": "Emailed to the client",
  "invoice.pdf_downloaded": "PDF downloaded",
};

/** A readable word for an audit action; one this screen doesn't know ("invoice.foo_bar") reads as "Foo bar", never hidden. */
export function activityLabel(action) {
  if (ACTIVITY_WORDS[action]) return ACTIVITY_WORDS[action];
  const tail = String(action ?? "").split(".").pop().replace(/_/g, " ").trim();
  return tail ? tail.charAt(0).toUpperCase() + tail.slice(1) : "Activity";
}
