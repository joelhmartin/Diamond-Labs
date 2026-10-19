import { CheckCircle2, XCircle } from "lucide-react";

/** Each carrier's state and, when disabled, why ("UPS: credentials not set (UPS_CLIENT_ID)"). */
export function CarriersPanel({ carriers }) {
  return (
    <section className="rounded-2xl border border-surface-300/50 bg-white p-4">
      <h2 className="mb-2 font-heading text-sm font-bold text-navy">Carriers</h2>
      <ul className="space-y-1 text-sm">
        {carriers.map((c) => (
          <li key={c.id} className="flex items-start gap-2">
            {c.ok ? <CheckCircle2 size={14} className="mt-0.5 text-emerald-600" /> : <XCircle size={14} className="mt-0.5 text-navy/30" />}
            <span>
              <span className="font-semibold text-navy">{c.label}</span>
              <span className="text-navy/50"> — {c.ok ? "enabled" : c.reason}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
