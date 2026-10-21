/**
 * Billing vocabulary shared by the API and the web: invoice states and kinds,
 * line kinds, price sources, manual payment methods, aging buckets and the
 * one status label a person sees. Rules (totals, transitions, balances) live
 * in apps/api/src/services/billing/invoice-rules.js.
 */
export const INVOICE_STATUSES = ["draft", "issued", "void"];
export const INVOICE_KINDS = ["order", "shop", "legacy"];
export const INVOICE_LINE_KINDS = ["item", "shipping", "fee", "adjustment"];
export const PRICE_SOURCES = ["client", "base", "manual", "remake", "unpriced", "shipment", "legacy"];

export const LINE_KIND_LABELS = { item: "Item", shipping: "Shipping", fee: "Fee", adjustment: "Adjustment" };
export const PRICE_SOURCE_LABELS = {
  client: "Client price", base: "Base price", manual: "Manual", remake: "Remake (no charge)", unpriced: "Needs a price", shipment: "Shipping label",
  legacy: "Seazona",
};

export const MANUAL_PAYMENT_METHODS = ["check", "cash", "ach", "other"];
export const MANUAL_PAYMENT_LABELS = { check: "Check", cash: "Cash", ach: "ACH", other: "Other" };
/** A manual payment's ledger source: admin_check | admin_cash | admin_ach | admin_other. */
export const manualPaymentSource = (method) => `admin_${method}`;
/** True for a ledger source written by a manual payment (check / cash / ACH / other). */
export const isManualPaymentSource = (source) => MANUAL_PAYMENT_METHODS.some((m) => manualPaymentSource(m) === source);

/** A staff credit / write-off: allocated like a payment, never sent to a card processor. */
export const CREDIT_SOURCE = "credit";
/** The ledger row that pays a shop invoice at checkout. */
export const SHOP_PAYMENT_SOURCE = "shop_card";
/**
 * Own-the-lab piece 5. A legacy invoice's settled part (total - Seazona's open
 * balance) is one ledger row with this source and transactionId
 * `legacy:<seazonaInvoiceId>`. It is bookkeeping, not a payment anyone made.
 */
export const LEGACY_SETTLEMENT_SOURCE = "legacy_settlement";
/** Ledger rows kept out of payment history and the refund screen. */
export const HISTORY_EXCLUDED_SOURCES = [SHOP_PAYMENT_SOURCE, LEGACY_SETTLEMENT_SOURCE];
/** legacySeazonaInvoiceId of a per-client opening-balance invoice: `opening:<account number>`. */
export const OPENING_BALANCE_PREFIX = "opening:";
export const isOpeningBalanceInvoice = (inv) =>
  inv?.kind === "legacy" && String(inv?.legacySeazonaInvoiceId ?? "").startsWith(OPENING_BALANCE_PREFIX);
/**
 * The default/summary-line description on an imported Seazona invoice. Other
 * imported lines may carry other fixed strings; the real text is sealed in
 * legacy_description.
 */
export const LEGACY_LINE_DESCRIPTION = "Carried over from Seazona";

export const AGING_BUCKETS = [
  { key: "current", label: "Current" },
  { key: "d1_30", label: "1–30" },
  { key: "d31_60", label: "31–60" },
  { key: "d61_90", label: "61–90" },
  { key: "d90_plus", label: "90+" },
];

/**
 * What a person sees for an invoice. Due dates are "YYYY-MM-DD", so string
 * order is date order; due today is not yet past due.
 */
export function invoiceStatusLabel({ status, balanceCents, dueDate }, todayIso) {
  if (status === "draft") return "Draft";
  if (status === "void") return "Void";
  if (balanceCents <= 0) return "Paid";
  if (dueDate && dueDate < todayIso) return "Past due";
  return "Open";
}
