import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2, Printer } from "lucide-react";
import { useResource } from "../../hooks/useResource.js";
import { errorText } from "../../lib/requests.js";
import { groupRows } from "../../lib/data-table/table-state.js";
import { addressLine, dayLabel, ordersLabel } from "../../lib/deliveries.js";

// Letter paper, one section per day; the toolbar never prints.
const PRINT_CSS = `
  @page { size: letter; margin: 0.5in; }
  @media print { .no-print { display: none !important; } html, body { background: #fff; } .day { break-inside: auto; } .day + .day { break-before: page; } }
  .sheet th, .sheet td { border: 1px solid #d1d5db; padding: 6px 8px; vertical-align: top; text-align: left; }
  .sheet th { background: #f3f4f6; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
  .sheet .blank { width: 1.1in; }
`;

/**
 * The driver's route sheet for `?from&to` (the API's default range without
 * them): a plain document, not a list UI, on its own page outside the app
 * shell like ShipmentLabelPrintPage. One section per day, stops numbered,
 * with blank Time / Signed columns. Order numbers only, never patient names.
 */
export function DeliveryRoutePrintPage() {
  const [params] = useSearchParams();
  const query = useMemo(() => {
    const out = {};
    if (params.get("from")) out.from = params.get("from");
    if (params.get("to")) out.to = params.get("to");
    return out;
  }, [params]);
  const { data, loading, error } = useResource("/lab/deliveries", { params: query });

  if (error) return <p className="p-8 text-sm text-red-700">{errorText(error)}</p>;
  if (loading && !data) return <div className="flex items-center gap-2 p-8 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" /> Loading route…</div>;

  const days = groupRows(data?.stops ?? [], (s) => s.day);
  return (
    <div className="mx-auto max-w-5xl p-6 text-gray-900">
      <style>{PRINT_CSS}</style>
      <div className="no-print mb-6 flex items-center gap-3 border-b border-gray-200 pb-4">
        <button type="button" onClick={() => window.print()} className="flex items-center gap-1.5 rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white">
          <Printer size={14} /> Print
        </button>
        <span className="text-xs text-gray-500">Letter paper, one page per day.</span>
      </div>
      <h1 className="mb-1 text-xl font-bold">Delivery route</h1>
      <p className="mb-6 text-sm text-gray-600">{data ? `${dayLabel(data.from)} – ${dayLabel(data.to)}` : ""}</p>
      {days.length === 0 && <p className="text-sm text-gray-600">No local deliveries or pickups in this range.</p>}
      {days.map(({ key: day, rows: stops }) => (
        <section key={day} className="day mb-8">
          <h2 className="mb-2 text-lg font-semibold">{dayLabel(day)} · {stops.length} {stops.length === 1 ? "stop" : "stops"}</h2>
          <table className="sheet w-full border-collapse text-sm">
            <thead>
              <tr>
                <th>#</th><th>Practice</th><th>Address</th><th>Phone</th><th>Orders</th><th>Pickup boxes</th>
                <th className="blank">Time</th><th className="blank">Signed</th>
              </tr>
            </thead>
            <tbody>
              {stops.map((s, i) => (
                <tr key={s.id}>
                  <td className="font-mono">{i + 1}</td>
                  <td>
                    <span className="font-semibold">{s.practice}</span>
                    {s.late && <span className="ml-1 text-xs font-semibold uppercase text-red-700">(late)</span>}
                  </td>
                  <td>
                    {addressLine(s.address)}
                    {s.deliveryNotes && <div className="mt-1 text-xs text-gray-600">{s.deliveryNotes}</div>}
                  </td>
                  <td className="whitespace-nowrap">{s.phone || ""}</td>
                  <td className="font-mono">{ordersLabel(s.orders)}</td>
                  <td>{s.pickups.map((p) => `#${p.pickupNumber}: ${p.boxCount}`).join(", ")}</td>
                  <td className="blank" />
                  <td className="blank" />
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
