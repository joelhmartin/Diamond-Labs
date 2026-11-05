import { LAB_STATUS_LABELS } from "@my-app/shared";
import { Panel } from "./Panel.jsx";

function moveLabel(from, to) {
  if (to === "on_hold") return "Put on hold";
  if (to === "cancelled") return "Cancel order";
  if (from === "on_hold") return `Resume — ${LAB_STATUS_LABELS[to]}`;
  return `→ ${LAB_STATUS_LABELS[to]}`;
}

/** The status moves an order may make next, one button each. */
export function StatusPanel({ order, moves, busy, onMove }) {
  return (
    <Panel title="Status">
      <div className="flex flex-col gap-2">
        {moves.length === 0 && <p className="text-sm text-navy/50">This order is closed.</p>}
        {moves.map((to) => (
          <button
            key={to}
            type="button"
            disabled={busy}
            onClick={() => onMove(to)}
            className={`rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40 ${
              to === "cancelled" ? "bg-red-50 text-red-700 hover:bg-red-100"
                : to === "on_hold" ? "bg-amber-50 text-amber-800 hover:bg-amber-100"
                : "bg-brand-500 text-white hover:bg-brand-600"
            }`}
          >
            {moveLabel(order.status, to)}
          </button>
        ))}
      </div>
    </Panel>
  );
}
