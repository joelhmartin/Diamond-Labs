import { Loader2 } from "lucide-react";

export const DRAWER_INPUT =
  "w-full px-3.5 py-2.5 rounded-lg bg-white border border-surface-300/60 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all placeholder:text-navy/25 disabled:bg-surface-100 disabled:text-navy/40";

/** A titled card in the admin payment drawer. */
export function SectionCard({ title, icon: Icon, children }) {
  return (
    <div className="rounded-2xl border border-surface-300/50 bg-white p-4">
      <h4 className="mb-3 flex items-center gap-2 font-heading text-sm font-bold text-navy">
        {Icon && <Icon size={14} className="text-brand-500" />}
        {title}
      </h4>
      {children}
    </div>
  );
}

/**
 * The three states every invoice-backed panel shares: still loading, couldn't
 * load (not the same as "owes nothing"), and nothing open. Children render
 * only when there are invoices to act on.
 */
export function InvoicesGate({ loading, unavailable, empty, emptyText, children }) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-navy/40">
        <Loader2 size={14} className="animate-spin" /> Loading invoices…
      </div>
    );
  }
  if (unavailable) return <p className="text-xs text-amber-700">Couldn't load this doctor's invoices — try again.</p>;
  if (empty) return <p className="text-xs text-navy/40">{emptyText}</p>;
  return children;
}
