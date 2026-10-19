import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, RefreshCw, Printer } from "lucide-react";
import { CARRIERS, CARRIER_LABELS, SHIPMENT_STATUSES, formatCents, formatLabDate } from "@my-app/shared";
import api from "../../config/api.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { ConfirmButton } from "../../components/ui/ConfirmButton.jsx";
import { CarriersPanel } from "../../components/lab/CarriersPanel.jsx";
import { labOrderPath, shipmentPrintPath } from "../../config/routes.js";
import { errorText } from "../../lib/requests.js";
import { INPUT_BASE } from "../../components/lab/form-styles.js";
import { shipmentLine, shipmentStatusLabel, shipmentListParams, canRefreshTracking } from "../../lib/shipping.js";

const ROW_BTN = "rounded-full bg-surface-100 px-2.5 py-1 text-[11px] font-semibold text-navy hover:bg-surface-200 disabled:opacity-40";

/** Admin › Shipments (lab staff and admins): every shipment, its orders, and the actions that apply. */
export function ShipmentsPage() {
  const { addToast } = useToast();
  const [filters, setFilters] = useState({ status: "", carrier: "", from: "", to: "" });
  const [data, setData] = useState(null);
  const [carriers, setCarriers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    // Only the newest request may write state: a slow earlier filter's response is dropped.
    const seq = ++loadSeq.current;
    try {
      const [list, c] = await Promise.all([
        api.get("/lab/shipments", { params: shipmentListParams(filters) }),
        api.get("/lab/carriers"),
      ]);
      if (seq !== loadSeq.current) return;
      setData(list.data.data);
      setCarriers(c.data.data.carriers);
      setLoadError(null);
    } catch (err) {
      if (seq !== loadSeq.current) return;
      setLoadError(errorText(err));
      addToast({ message: errorText(err), type: "error" });
    }
  }, [filters, addToast]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn, success) => {
    setBusy(true);
    try {
      const res = await fn();
      addToast({ message: typeof success === "function" ? success(res.data.data) : success, type: "success" });
      await load();
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    } finally {
      setBusy(false);
    }
  };
  const setFilter = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Shipments</h1>
        <ConfirmButton
          onConfirm={() => act(() => api.post("/lab/shipments/mark-all-shipped"), (d) => `${d.shipped} shipped${d.failed ? `, ${d.failed} failed (see logs)` : ""}`)}
          disabled={busy}
          confirmLabel="Click again: every labelled box has left"
          className="rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90"
        >
          Mark all labelled shipped
        </ConfirmButton>
      </div>

      <CarriersPanel carriers={carriers} />

      <div className="flex flex-wrap gap-2">
        <select className={INPUT_BASE} value={filters.status} onChange={setFilter("status")}>
          <option value="">Any status</option>
          {SHIPMENT_STATUSES.map((s) => <option key={s} value={s}>{shipmentStatusLabel(s)}</option>)}
        </select>
        <select className={INPUT_BASE} value={filters.carrier} onChange={setFilter("carrier")}>
          <option value="">Any carrier</option>
          {CARRIERS.map((c) => <option key={c} value={c}>{CARRIER_LABELS[c]}</option>)}
        </select>
        <input type="date" className={INPUT_BASE} value={filters.from} onChange={setFilter("from")} aria-label="From" />
        <input type="date" className={INPUT_BASE} value={filters.to} onChange={setFilter("to")} aria-label="To" />
      </div>

      {loadError && !data ? (
        <div className="flex items-center gap-3 py-10 text-sm text-red-700">
          {loadError}
          <button type="button" className={ROW_BTN} onClick={load}>Retry</button>
        </div>
      ) : !data ? (
        <div className="flex items-center gap-2 py-10 text-sm text-navy/50"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : data.shipments.length === 0 ? (
        <p className="py-10 text-center text-sm text-navy/50">No shipments match.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-surface-300/50 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="text-[10px] font-mono uppercase tracking-widest text-navy/40">
              <tr><th className="px-3 py-2">Bought</th><th>Shipment</th><th>Status</th><th>Orders</th><th>To</th><th>Charge</th><th>By</th><th /></tr>
            </thead>
            <tbody>
              {data.shipments.map((s) => (
                <tr key={s.id} className="border-t border-surface-300/40 align-top">
                  <td className="px-3 py-2 text-xs text-navy/60">{formatLabDate(s.purchasedAt)}</td>
                  <td className="py-2">
                    {s.trackingUrl ? <a href={s.trackingUrl} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">{shipmentLine(s)}</a> : shipmentLine(s)}
                    {s.trackingError && <div className="text-[11px] text-red-700">{s.trackingError}</div>}
                  </td>
                  <td className="py-2 text-xs">{shipmentStatusLabel(s.status)}</td>
                  <td className="py-2 text-xs">
                    {s.orders.length ? s.orders.map((o) => <Link key={o.id} to={labOrderPath(o.id)} className="mr-1 font-mono text-brand-600 hover:underline">#{o.orderNumber}</Link>) : "—"}
                  </td>
                  <td className="py-2 text-xs text-navy/70">{s.shipToName ?? "—"}</td>
                  <td className="py-2 font-mono text-xs">{formatCents(s.chargeCents)}</td>
                  <td className="py-2 text-xs text-navy/60">{s.createdByName ?? "—"}</td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap justify-end gap-1">
                      {s.hasLabel && <a href={shipmentPrintPath(s.id)} target="_blank" rel="noreferrer" className={ROW_BTN}><Printer size={10} className="inline" /> Print</a>}
                      {s.canMarkShipped && <button type="button" disabled={busy} className={ROW_BTN} onClick={() => act(() => api.post(`/lab/shipments/${s.id}/mark-shipped`), "Marked shipped")}>Mark shipped</button>}
                      {canRefreshTracking(s) && (
                        <button type="button" disabled={busy} className={ROW_BTN} onClick={() => act(() => api.post(`/lab/shipments/${s.id}/refresh-tracking`), (d) => (d.updated ? "Tracking updated" : "No change"))}>
                          <RefreshCw size={10} className="inline" /> Tracking
                        </button>
                      )}
                      {s.canVoid && (
                        <ConfirmButton onConfirm={() => act(() => api.post(`/lab/shipments/${s.id}/void`), "Label voided")} disabled={busy} confirmLabel="Click again to void" className={`${ROW_BTN} bg-red-50 text-red-700`}>
                          Void
                        </ConfirmButton>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.truncated && <p className="p-3 text-xs text-navy/50">Showing the newest 500. Narrow the dates to see older shipments.</p>}
        </div>
      )}
    </div>
  );
}
