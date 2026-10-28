import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { LAB_BOARD_COLUMNS, LAB_STATUS_LABELS } from "@my-app/shared";
import { DataTable } from "../ui/data-table/index.js";
import { useDataTable } from "../../hooks/useDataTable.js";
import { commonMoves, moveOrders } from "../../lib/lab-board.js";
import { boardColumns } from "./board-columns.jsx";

function StatusSection({ status, cards, columns, post, onChanged }) {
  const [open, setOpen] = useState(false);
  const overdue = cards.filter((c) => c.overdue).length;
  return (
    <section className="rounded-3xl bg-surface-50 p-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-left hover:bg-white/60"
      >
        <ChevronRight size={14} className={`text-navy/40 transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="text-[11px] font-mono uppercase tracking-widest text-navy/60">{LAB_STATUS_LABELS[status]}</span>
        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-navy">{cards.length}</span>
        {overdue > 0 && <span className="text-[11px] font-semibold text-red-600">· {overdue} overdue</span>}
      </button>
      {open && <SectionTable status={status} cards={cards} columns={columns} post={post} onChanged={onChanged} />}
    </section>
  );
}

// Mounted only while open, so a collapsed section costs nothing.
function SectionTable({ status, cards, columns, post, onChanged }) {
  const table = useDataTable({ mode: "client", rows: cards, getRowId: (c) => c.id, initialPageSize: 20 });
  const moves = commonMoves(table.selection.selectedRows);
  const bulkActions = moves.map((m) => ({
    id: `move-${m.to}`,
    label: `Move to ${m.label.replace(/^→\s*/, "")}`,
    run: async (rows) => {
      const result = await moveOrders(rows, m.to, post);
      onChanged();
      return result;
    },
  }));
  return (
    <div className="px-1 pb-2 pt-1">
      <DataTable
        table={table}
        columns={columns}
        bulkActions={bulkActions}
        searchable={false}
        itemLabel="orders"
        exportFileName={`${status}-orders.csv`}
        emptyText="No orders in this status."
      />
    </div>
  );
}

/** The production board as a stack of collapsible status tables (all closed on load). */
export function BoardTableView({ columns: byStatus, busyId, onMove, onChanged, post }) {
  const columns = useMemo(() => boardColumns({ busyId, onMove }), [busyId, onMove]);
  return (
    <div className="space-y-3">
      {LAB_BOARD_COLUMNS.map((status) => (
        <StatusSection key={status} status={status} cards={byStatus[status] ?? []} columns={columns} post={post} onChanged={onChanged} />
      ))}
    </div>
  );
}
