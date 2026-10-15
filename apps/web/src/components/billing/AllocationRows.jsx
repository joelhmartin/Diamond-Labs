import { formatCents } from "../../lib/money.js";
import { dateText } from "../../lib/invoices.js";

/**
 * The per-invoice "how much goes to each" rows every payment surface shows:
 * the doctor's PaymentModal, the admin charge panel and Record payment.
 * It only renders; the owner keeps the amounts (useInvoiceAllocation, or a
 * typed-amounts map) and says what each row currently holds.
 *
 * rows:     [{ id, invoiceNumber, balanceCents, dueDate? }], in display order
 * valueOf:  (row) → what the input shows, in dollars (number or typed string)
 * onChange: (row, typedValue) → void
 * appliedCentsOf: optional (row) → cents; adds a "paid in full" / "partial" tag
 */
export function AllocationRows({ rows, valueOf, onChange, disabled = false, showDue = false, appliedCentsOf = null, inputClassName = "", className = "max-h-44" }) {
  return (
    <div className={`space-y-1 overflow-y-auto ${className}`}>
      {rows.map((inv) => {
        const applied = appliedCentsOf ? appliedCentsOf(inv) : null;
        const tag = applied == null || applied <= 0 ? "" : applied >= inv.balanceCents ? "paid in full" : "partial";
        return (
          <div key={inv.id} className="flex items-center gap-2 text-sm">
            <span className="w-20 shrink-0 font-mono text-xs font-medium">#{inv.invoiceNumber}</span>
            {showDue && <span className="w-24 shrink-0 text-xs text-gray-500">due {dateText(inv.dueDate)}</span>}
            <span className="w-20 shrink-0 text-xs text-gray-400">{formatCents(inv.balanceCents)}</span>
            <span className="text-gray-300">→</span>
            <input
              type="number"
              min="0"
              max={inv.balanceCents / 100}
              step="0.01"
              placeholder="0.00"
              value={valueOf(inv)}
              onChange={(e) => onChange(inv, e.target.value)}
              disabled={disabled}
              aria-label={`Amount for invoice ${inv.invoiceNumber}`}
              className={`w-24 rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-gray-100 disabled:text-gray-400 ${inputClassName}`}
            />
            {tag && <span className={`text-xs ${applied >= inv.balanceCents ? "text-green-600" : "text-amber-600"}`}>{tag}</span>}
          </div>
        );
      })}
    </div>
  );
}
