// Labels and small formatters for the admin Payments screen (history rows and the per-charge audit trail).

export function formatUSD(n) {
  return Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function formatDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  return dt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  return dt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const AUDIT_ACTION_LABEL = {
  "payment.charge": "Charged",
  "payment.refund": "Reversed",
  "payment.offline_recorded": "Offline payment recorded",
  "payment.manual_recorded": "Payment recorded",
  "payment.card.set_default": "Set default card",
  "payment.card.delete": "Deleted card",
};

export function auditLabel(e) {
  if (e.action === "payment.refund") {
    return e.metadata?.kind === "void" ? "Voided" : "Refunded";
  }
  return AUDIT_ACTION_LABEL[e.action] || e.action;
}

const STATUS_PILL = {
  paid: "bg-emerald-500/10 text-emerald-700",
  partially_refunded: "bg-amber-500/10 text-amber-700",
  refunded: "bg-gray-200 text-gray-600",
  refund_pending: "bg-blue-500/10 text-blue-700",
};
const STATUS_LABEL = {
  paid: "Paid",
  partially_refunded: "Partially refunded",
  refunded: "Refunded",
  refund_pending: "Refund pending",
};

// How the payment was initiated. AutoPay is the one nobody clicked, so the lab
// needs to see it distinctly when reconciling — otherwise a scheduled charge is
// indistinguishable from one a doctor or an admin made by hand. Rows written
// before the `source` column existed carry null; render nothing rather than guess.
export const SOURCE_LABEL = {
  autopay: "AutoPay",
  doctor_card: "Doctor — card",
  doctor_hosted: "Doctor — card",
  admin_card: "Admin — card",
  admin_offline: "Offline",
  admin_check: "Check",
  admin_cash: "Cash",
  admin_ach: "ACH",
  admin_other: "Other (recorded)",
  credit: "Credit",
  refund: "Refund",
};

export function StatusPill({ status }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
        STATUS_PILL[status] || "bg-gray-200 text-gray-700"
      }`}
    >
      {STATUS_LABEL[status] || status}
    </span>
  );
}
