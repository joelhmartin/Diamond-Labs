import { formatCents } from "./money.js";
import { ledgerInvoiceKey } from "./payment-summary.js";

/** The invoice keys a reversal row copies from the row it reverses (local id, and Seazona ids on Seazona-era rows). */
export const invoiceKeysOf = (r) => ({
  invoiceId: r.invoiceId ?? null,
  seazonaClientId: r.seazonaClientId ?? null,
  seazonaInvoiceId: r.seazonaInvoiceId ?? null,
  invoiceNumber: r.invoiceNumber ?? null,
});

/**
 * Plan the ledger side of a refund. No `allocations` → FULL: negate every
 * original row (the gateway reverses the whole charge; totalCents null).
 * With `allocations` ([{ invoiceId, amountCents }], invoiceId = the row's
 * ledgerInvoiceKey) → PARTIAL: one negative row per named slice, each capped at
 * what that invoice was charged. Returns { totalCents, rows } or { error }.
 */
export function planRefund(originalRows, allocations) {
  if (!allocations) {
    return { totalCents: null, rows: originalRows.map((r) => ({ ...invoiceKeysOf(r), userId: r.userId ?? null, appliedCents: -r.appliedCents })) };
  }
  const charged = new Map();
  for (const r of originalRows) {
    const key = String(ledgerInvoiceKey(r));
    const c = charged.get(key);
    charged.set(key, { row: c?.row ?? r, cents: (c?.cents ?? 0) + r.appliedCents });
  }
  const seen = new Set();
  const rows = [];
  for (const a of allocations) {
    const key = String(a.invoiceId);
    const c = charged.get(key);
    if (!c) return { error: `Invoice ${key} is not part of this charge.` };
    if (seen.has(key)) return { error: `Invoice ${key} appears more than once.` };
    seen.add(key);
    if (a.amountCents > c.cents) {
      return { error: `Refund for invoice ${c.row.invoiceNumber || key} exceeds the ${formatCents(c.cents)} charged to it.` };
    }
    rows.push({ ...invoiceKeysOf(c.row), userId: c.row.userId ?? null, appliedCents: -a.amountCents });
  }
  return { totalCents: rows.reduce((s, r) => s - r.appliedCents, 0), rows };
}
