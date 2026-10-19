import { Loader2, AlertCircle } from "lucide-react";
import { formatCents, CARRIER_LABELS } from "@my-app/shared";
import { INPUT } from "./form-styles.js";
import { quoteId } from "../../lib/shipping.js";


/**
 * Get rates from every enabled carrier, then pick a service, or Manual (a
 * courier, a hand delivery): staff type the carrier and, if there is one, the
 * tracking number. A carrier that failed or is disabled says why and never
 * hides the others.
 */
export function RateChooser({ rates, stale, choice, manual, busy, carriers = [], onGetRates, onChoose, onManual }) {
  const picked = choice ? (choice.carrier === "manual" ? "manual" : quoteId(choice)) : null;
  const off = carriers.filter((c) => !c.ok);
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-bold uppercase tracking-wider text-navy/50">Service</legend>
      <button type="button" onClick={onGetRates} disabled={busy} className="mb-2 flex items-center gap-1.5 rounded-full bg-surface-100 px-4 py-1.5 text-xs font-semibold text-navy hover:bg-surface-200 disabled:opacity-40">
        {busy && <Loader2 size={12} className="animate-spin" />} {rates ? "Refresh rates" : "Get rates"}
      </button>
      {stale && <p className="mb-2 text-xs text-amber-700">The box or address changed — get rates again before buying.</p>}
      {off.map((c) => <p key={c.id} className="text-xs text-navy/40">{c.reason}</p>)}
      {rates?.errors.map((e) => (
        <p key={e.carrier} className="flex items-center gap-1 text-xs text-red-700"><AlertCircle size={11} /> {CARRIER_LABELS[e.carrier] ?? e.carrier}: {e.message}</p>
      ))}
      <div className="mt-2 space-y-1">
        {rates?.quotes.map((q) => (
          <label key={quoteId(q)} className="flex items-center justify-between gap-3 rounded-lg border border-surface-300/50 px-3 py-2 text-sm">
            <span className="flex items-center gap-2">
              <input type="radio" name="service" checked={picked === quoteId(q)} onChange={() => onChoose(q)} disabled={busy || stale} />
              {q.serviceName}{q.estimatedDelivery ? <span className="text-xs text-navy/40"> · {q.estimatedDelivery}</span> : null}
            </span>
            <span className="font-mono text-xs">{formatCents(q.amountCents)}</span>
          </label>
        ))}
        <label className="flex items-center gap-2 rounded-lg border border-dashed border-surface-300 px-3 py-2 text-sm">
          <input type="radio" name="service" checked={picked === "manual"} onChange={() => onChoose({ carrier: "manual" })} disabled={busy} />
          Manual — a courier, hand delivery or another carrier
        </label>
        {picked === "manual" && (
          <div className="grid gap-2 pl-6 sm:grid-cols-2">
            <input className={INPUT} placeholder="Carrier name" maxLength={40} value={manual.carrierName} onChange={(e) => onManual({ ...manual, carrierName: e.target.value })} disabled={busy} />
            <input className={INPUT} placeholder="Tracking number (optional)" maxLength={40} value={manual.trackingNumber} onChange={(e) => onManual({ ...manual, trackingNumber: e.target.value })} disabled={busy} />
          </div>
        )}
      </div>
    </fieldset>
  );
}
