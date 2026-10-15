import { useState } from "react";
import { INVOICE_LINE_KINDS, LINE_KIND_LABELS, PRICE_SOURCE_LABELS, parseMoneyInput } from "@my-app/shared";
import { ConfirmButton } from "../ui/ConfirmButton.jsx";
import { formatCents } from "../../lib/money.js";

const INPUT = "rounded-lg border border-surface-300/60 bg-white px-2.5 py-1.5 text-sm text-navy focus:border-brand-500 focus:outline-none";
const PILL = "rounded-full px-3 py-1.5 text-xs font-semibold";
const BLANK_LINE = { kind: "fee", description: "", qty: "1", priceStr: "", taxable: false };

/**
 * A draft invoice's lines, editable: quantity, price (with a reason), remove,
 * and add a free-form line. `onEdit(edit)` sends one PATCH and resolves true
 * when it applied; the server holds the rules (reason required for a price
 * change, negatives only on an adjustment).
 */
export function DraftLinesEditor({ lines, onEdit, busy }) {
  const [pricing, setPricing] = useState(null); // { lineId, priceStr, reason }
  const [adding, setAdding] = useState(BLANK_LINE);
  const addCents = parseMoneyInput(adding.priceStr, { allowNegative: adding.kind === "adjustment" });

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-2xl border border-surface-300/50 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-50 text-[11px] uppercase tracking-wide text-navy/50">
            <tr><th className="px-3 py-2">Qty</th><th className="px-3 py-2">Code</th><th className="px-3 py-2">Description</th><th className="px-3 py-2 text-right">Unit</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-surface-300/30 align-top">
                <td className="px-3 py-2">
                  <input key={`${l.id}:${l.qty}`} className={`${INPUT} w-16`} type="number" min="1" max="999" defaultValue={l.qty} disabled={busy} aria-label={`Quantity for ${l.description}`}
                    onBlur={(e) => { const qty = Number(e.target.value); if (Number.isInteger(qty) && qty !== l.qty) onEdit({ op: "update", lineId: l.id, qty }); }} />
                </td>
                <td className="px-3 py-2 font-mono text-xs">{l.code ?? "—"}</td>
                <td className="px-3 py-2">
                  {l.description}
                  <div className={`text-[11px] ${l.priceSource === "unpriced" ? "font-semibold text-red-700" : "text-navy/40"}`}>
                    {LINE_KIND_LABELS[l.kind]} · {PRICE_SOURCE_LABELS[l.priceSource]}{l.priceNote ? ` — ${l.priceNote}` : ""}
                  </div>
                  {pricing?.lineId === l.id && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input className={`${INPUT} w-24`} inputMode="decimal" placeholder="0.00" value={pricing.priceStr} onChange={(e) => setPricing({ ...pricing, priceStr: e.target.value })} aria-label="New unit price" />
                      <input className={`${INPUT} flex-1`} placeholder="Why (required)" value={pricing.reason} onChange={(e) => setPricing({ ...pricing, reason: e.target.value })} aria-label="Reason for the price change" />
                      <button type="button" className={`${PILL} bg-brand-500 text-white disabled:opacity-50`} disabled={busy || !pricing.reason.trim() || parseMoneyInput(pricing.priceStr, { allowNegative: l.kind === "adjustment" }) == null}
                        onClick={async () => {
                          const unitCents = parseMoneyInput(pricing.priceStr, { allowNegative: l.kind === "adjustment" });
                          if (await onEdit({ op: "update", lineId: l.id, unitCents, reason: pricing.reason.trim() })) setPricing(null);
                        }}>Save price</button>
                      <button type="button" className={`${PILL} text-navy/50`} onClick={() => setPricing(null)}>Cancel</button>
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <button type="button" className="text-brand-700 hover:underline" disabled={busy}
                    onClick={() => setPricing({ lineId: l.id, priceStr: (l.unitCents / 100).toFixed(2), reason: "" })}>
                    {formatCents(l.unitCents)}
                  </button>
                </td>
                <td className="px-3 py-2 text-right">{formatCents(l.lineCents)}</td>
                <td className="px-3 py-2 text-right">
                  <ConfirmButton className={`${PILL} text-red-600`} confirmLabel="Remove?" disabled={busy} onConfirm={() => onEdit({ op: "remove", lineId: l.id })}>Remove</ConfirmButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-dashed border-surface-300 p-3">
        <select className={INPUT} value={adding.kind} onChange={(e) => setAdding({ ...adding, kind: e.target.value })} aria-label="Line kind">
          {INVOICE_LINE_KINDS.map((k) => <option key={k} value={k}>{LINE_KIND_LABELS[k]}</option>)}
        </select>
        <input className={`${INPUT} min-w-[12rem] flex-1`} placeholder="Description (e.g. Rush fee)" value={adding.description} onChange={(e) => setAdding({ ...adding, description: e.target.value })} />
        <input className={`${INPUT} w-16`} type="number" min="1" max="999" value={adding.qty} onChange={(e) => setAdding({ ...adding, qty: e.target.value })} aria-label="Quantity" />
        <input className={`${INPUT} w-24`} inputMode="decimal" placeholder={adding.kind === "adjustment" ? "-0.00" : "0.00"} value={adding.priceStr} onChange={(e) => setAdding({ ...adding, priceStr: e.target.value })} aria-label="Unit price" />
        {adding.kind !== "shipping" && (
          <label className="flex items-center gap-1 text-xs text-navy/60">
            <input type="checkbox" className="accent-brand-600" checked={adding.taxable} onChange={(e) => setAdding({ ...adding, taxable: e.target.checked })} /> Taxable
          </label>
        )}
        <button type="button" className={`${PILL} bg-surface-100 text-navy hover:bg-surface-200 disabled:opacity-50`}
          disabled={busy || !adding.description.trim() || addCents == null || !Number.isInteger(Number(adding.qty))}
          onClick={async () => {
            const ok = await onEdit({ op: "add", kind: adding.kind, description: adding.description.trim(), qty: Number(adding.qty), unitCents: addCents, taxable: adding.kind === "shipping" ? false : adding.taxable });
            if (ok) setAdding(BLANK_LINE);
          }}>
          Add line
        </button>
      </div>
    </div>
  );
}
