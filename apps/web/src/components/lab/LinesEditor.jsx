import { useMemo, useState } from "react";
import { LAB_LINE_QTY_MAX } from "@my-app/shared";
import api from "../../config/api.js";
import { useToast } from "../ui/Toast.jsx";
import { ConfirmButton } from "../ui/ConfirmButton.jsx";
import { DataTable } from "../ui/data-table/index.js";
import { useDataTable } from "../../hooks/useDataTable.js";
import { errorText, isStale } from "../../lib/requests.js";
import { INPUT_BASE } from "./form-styles.js";
import { LinePicker } from "./order-entry/LinePicker.jsx";

/** Quantity box that saves when it loses focus (or on Enter) with a changed, valid value. */
function QtyCell({ line, disabled, onSave }) {
  const [text, setText] = useState(String(line.qty));
  const commit = () => {
    const n = Number(text);
    if (!Number.isInteger(n) || n < 1 || n > LAB_LINE_QTY_MAX) { setText(String(line.qty)); return; }
    if (n !== line.qty) onSave(line, n);
  };
  return (
    <input
      type="number"
      aria-label={`Quantity of ${line.name}`}
      className={`${INPUT_BASE} w-20`}
      min={1}
      max={LAB_LINE_QTY_MAX}
      disabled={disabled}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
    />
  );
}

/**
 * The order's product lines: change a quantity, remove a line, or add one from the catalog.
 * Each change posts one op to /lab/orders/:id/lines with the order's version. The server
 * edits the draft invoice with the order and refuses once the invoice is issued (422); a
 * STALE reply reloads. `lines` are the billable lines (instructions are shown elsewhere).
 */
export function LinesEditor({ order, lines, onChanged }) {
  const { addToast } = useToast();
  const [busy, setBusy] = useState(false);
  const locked = order.status === "shipped" || order.status === "cancelled";
  const table = useDataTable({ mode: "client", rows: lines, initialPageSize: 1000 });

  const send = async (body, success) => {
    setBusy(true);
    try {
      await api.post(`/lab/orders/${order.id}/lines`, { ...body, expectedVersion: order.version });
      addToast({ message: success, type: "success" });
      await onChanged?.();
    } catch (err) {
      addToast({ message: isStale(err) ? `${errorText(err)} The latest version has been loaded.` : errorText(err), type: "error" });
      if (isStale(err)) await onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const columns = useMemo(() => [
    { id: "qty", header: "Qty", cell: (l) => <QtyCell key={`${l.id}:${l.qty}`} line={l} disabled={busy || locked} onSave={(line, qty) => send({ op: "update", lineId: line.id, qty }, "Quantity saved.")} /> },
    { id: "code", header: "Code", cell: (l) => <span className="font-mono text-xs">{l.code ?? "—"}</span> },
    { id: "name", header: "Item", cell: (l) => l.name },
    { id: "arch", header: "Arch", cell: (l) => <span className="text-navy/60">{l.arch ?? ""}</span> },
    {
      id: "actions", header: "", export: false, align: "right",
      cell: (l) => (
        <ConfirmButton disabled={busy || locked} onConfirm={() => send({ op: "remove", lineId: l.id }, "Line removed.")} confirmLabel="Click again to remove">Remove</ConfirmButton>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps -- send closes over the current order version
  ], [busy, locked, order.id, order.version]);

  return (
    <div className="space-y-3">
      <DataTable table={table} columns={columns} searchable={false} selectable={false} exportable={false} paginated={false} dense itemLabel="lines" emptyText="No lines." />
      {!locked && <LinePicker disabled={busy} onAdd={({ variantId, qty }) => send({ op: "add", variantId, qty }, "Line added.")} />}
    </div>
  );
}
