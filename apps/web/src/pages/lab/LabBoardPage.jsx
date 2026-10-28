import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw, Search, AlertCircle, Truck, LayoutGrid, Rows3 } from "lucide-react";
import { LAB_BOARD_COLUMNS, LAB_STATUS_LABELS, isTerminalLabStatus } from "@my-app/shared";
import api from "../../config/api.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { groupByStatus, boardParams } from "../../lib/lab-board.js";
import { labelBadge } from "../../lib/shipping.js";
import { ConfirmButton } from "../../components/ui/ConfirmButton.jsx";
import { errorText, isStale } from "../../lib/requests.js";
import { BoardCard } from "../../components/lab/BoardCard.jsx";
import { BoardTableView } from "../../components/lab/BoardTableView.jsx";
import { SegmentedControl } from "../../components/ui/SegmentedControl.jsx";
import { INPUT_BASE } from "../../components/lab/form-styles.js";

const PAGE_STEP = 25;
const VIEW_KEY = "lab.board.view";

function readView() {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === "board" || v === "table" ? v : "table";
  } catch {
    return "table";
  }
}

function KanbanColumn({ status, cards, busyId, onMove }) {
  const [shown, setShown] = useState(PAGE_STEP);
  return (
    <section className="flex min-h-[200px] flex-col rounded-3xl bg-surface-50 p-3">
      <h2 className="mb-3 flex items-center justify-between px-1 text-[11px] font-mono uppercase tracking-widest text-navy/50">
        {LAB_STATUS_LABELS[status]}
        <span className="rounded-full bg-white px-2 py-0.5 text-navy">{cards.length}</span>
      </h2>
      <div className="flex flex-col gap-2">
        {cards.slice(0, shown).map((card) => (
          <BoardCard key={card.id} card={card} busy={busyId === card.id} onMove={onMove} />
        ))}
        {cards.length > shown && (
          <button
            type="button"
            onClick={() => setShown((n) => n + PAGE_STEP)}
            className="rounded-full bg-white px-3 py-2 text-xs font-semibold text-navy hover:bg-surface-100"
          >
            Show {Math.min(PAGE_STEP, cards.length - shown)} more
          </button>
        )}
      </div>
    </section>
  );
}

export function LabBoardPage() {
  const { addToast } = useToast();
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [staff, setStaff] = useState([]);
  const [view, setViewState] = useState(readView);
  const setView = (v) => {
    setViewState(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage unavailable: the choice just won't persist */ }
  };
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState({ departmentId: "", assigneeUserId: "", rush: false, dueBefore: "", q: "" });

  // Only the newest request may write results: a slow response for an older
  // filter must not overwrite what the current filter shows.
  const requestSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    try {
      const res = await api.get("/lab/orders", { params: boardParams(filters) });
      if (seq !== requestSeq.current) return;
      setCards(res.data.data.orders);
      setError(null);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(errorText(err));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    Promise.all([api.get("/lab/departments"), api.get("/lab/staff")])
      .then(([d, s]) => {
        setDepartments(d.data.data.departments);
        setStaff(s.data.data.staff);
      })
      .catch((err) => setError(errorText(err)));
  }, []);

  const columns = useMemo(() => groupByStatus(cards), [cards]);
  const openCount = cards.filter((c) => !isTerminalLabStatus(c.status)).length;
  const overdueCount = cards.filter((c) => c.overdue).length;

  const move = async (card, to) => {
    setBusyId(card.id);
    try {
      await api.post(`/lab/orders/${card.id}/status`, { to, expectedVersion: card.version });
      await load();
    } catch (err) {
      addToast({ message: isStale(err) ? `${errorText(err)} The board has been refreshed.` : errorText(err), type: "error" });
      if (isStale(err)) await load();
    } finally {
      setBusyId(null);
    }
  };

  // End-of-day hand-off: every labelled box that hasn't left yet.
  const labelledWaiting = cards.filter((c) => labelBadge(c)).length;
  const markAllShipped = async () => {
    try {
      const { shipped, failed } = (await api.post("/lab/shipments/mark-all-shipped")).data.data;
      addToast({ message: failed ? `${shipped} shipped, ${failed} failed. Check the logs or retry.` : `${shipped} shipped`, type: failed ? "error" : "success" });
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    }
    await load();
  };

  const set = (patch) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Production</h1>
          <p className="mt-1 text-sm text-navy/50">
            {openCount} open job{openCount === 1 ? "" : "s"}
            {overdueCount > 0 && <span className="ml-2 font-semibold text-red-600">· {overdueCount} overdue</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {labelledWaiting > 0 && (
            <ConfirmButton
              onConfirm={markAllShipped}
              confirmLabel="Click again to mark every labelled box shipped"
              className="flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              <Truck size={12} /> Mark all labelled shipped
            </ConfirmButton>
          )}
          <SegmentedControl
            value={view}
            onChange={setView}
            options={[
              { value: "table", label: "Table", icon: <Rows3 size={12} /> },
              { value: "board", label: "Board", icon: <LayoutGrid size={12} /> },
            ]}
          />
          <button
            type="button"
            onClick={() => { setLoading(true); load(); }}
            className="flex items-center gap-1.5 rounded-full bg-surface-100 px-4 py-2 text-xs font-semibold text-navy hover:bg-surface-200"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => { e.preventDefault(); set({ q: query }); }}
          className="relative"
        >
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy/30" />
          <input
            className={`${INPUT_BASE} pl-8 w-64`}
            placeholder="Order #, case #, practice…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>
        <select className={INPUT_BASE} value={filters.departmentId} onChange={(e) => set({ departmentId: e.target.value })}>
          <option value="">All departments</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select className={INPUT_BASE} value={filters.assigneeUserId} onChange={(e) => set({ assigneeUserId: e.target.value })}>
          <option value="">Anyone</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-navy">
          <input type="checkbox" checked={filters.rush} onChange={(e) => set({ rush: e.target.checked })} /> Rush only
        </label>
        <label className="flex items-center gap-1.5 text-sm text-navy">
          Due by
          <input type="date" className={INPUT_BASE} value={filters.dueBefore} onChange={(e) => set({ dueBefore: e.target.value })} />
        </label>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {loading && cards.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-navy/40">
          <Loader2 size={18} className="mr-2 animate-spin" /> Loading the board…
        </div>
      ) : view === "table" ? (
        <BoardTableView columns={columns} busyId={busyId} onMove={move} onChanged={load} />
      ) : (
        <div className="grid auto-cols-[minmax(250px,1fr)] grid-flow-col gap-4 overflow-x-auto pb-4">
          {LAB_BOARD_COLUMNS.map((status) => (
            <KanbanColumn key={status} status={status} cards={columns[status]} busyId={busyId} onMove={move} />
          ))}
        </div>
      )}
    </div>
  );
}
