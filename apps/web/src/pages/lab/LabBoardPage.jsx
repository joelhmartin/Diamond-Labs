import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, RefreshCw, Search, AlertTriangle, Zap, RotateCcw, AlertCircle } from "lucide-react";
import { LAB_BOARD_COLUMNS, LAB_STATUS_LABELS, formatUsDate } from "@my-app/shared";
import api from "../../config/api.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { labOrderPath } from "../../config/routes.js";
import { groupByStatus, quickMoves, boardParams, errorText, isStale } from "../../lib/lab-board.js";

const INPUT =
  "px-3 py-2 rounded-lg bg-white border border-surface-300/60 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10";

const dueText = (due) => (due ? `Due ${formatUsDate(due)}` : "No due date");

function Card({ card, busy, onMove }) {
  const moves = quickMoves(card);
  return (
    <div className={`rounded-2xl border bg-white p-3 shadow-sm ${card.overdue ? "border-red-300" : "border-surface-300/50"}`}>
      <div className="flex items-start justify-between gap-2">
        <Link to={labOrderPath(card.id)} className="font-mono text-sm font-bold text-navy hover:text-brand-600">
          #{card.orderNumber}
        </Link>
        <div className="flex flex-wrap justify-end gap-1">
          {card.rush && (
            <span title={card.rushTier || "Rush"} className="flex items-center gap-0.5 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-red-700">
              <Zap size={10} /> Rush
            </span>
          )}
          {card.isRemake && (
            <span className="flex items-center gap-0.5 rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-violet-700">
              <RotateCcw size={10} /> Remake
            </span>
          )}
        </div>
      </div>
      <div className="mt-1 truncate text-xs text-navy/60">{card.practice}</div>
      <div className="mt-0.5 truncate text-xs text-navy" title={card.deviceSummary}>{card.deviceSummary}</div>
      {card.reference && <div className="mt-0.5 font-mono text-[10px] text-navy/40">{card.reference}</div>}
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <span className={card.overdue ? "flex items-center gap-1 font-semibold text-red-600" : "text-navy/50"}>
          {card.overdue && <AlertTriangle size={11} />}
          {dueText(card.dueDate)}
        </span>
        {card.assigneeInitials && (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-navy/10 text-[10px] font-bold text-navy">
            {card.assigneeInitials}
          </span>
        )}
      </div>
      {moves.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {moves.map((m) => (
            <button
              key={m.to}
              type="button"
              disabled={busy}
              onClick={() => onMove(card, m.to)}
              className="rounded-full bg-surface-100 px-2.5 py-1 text-[11px] font-semibold text-navy hover:bg-surface-200 disabled:opacity-40"
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
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

  const set = (patch) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Production</h1>
          <p className="mt-1 text-sm text-navy/50">
            {cards.length} open job{cards.length === 1 ? "" : "s"}
            {overdueCount > 0 && <span className="ml-2 font-semibold text-red-600">· {overdueCount} overdue</span>}
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setLoading(true); load(); }}
          className="flex items-center gap-1.5 rounded-full bg-surface-100 px-4 py-2 text-xs font-semibold text-navy hover:bg-surface-200"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => { e.preventDefault(); set({ q: query }); }}
          className="relative"
        >
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy/30" />
          <input
            className={`${INPUT} pl-8 w-64`}
            placeholder="Order #, case #, practice…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>
        <select className={INPUT} value={filters.departmentId} onChange={(e) => set({ departmentId: e.target.value })}>
          <option value="">All departments</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select className={INPUT} value={filters.assigneeUserId} onChange={(e) => set({ assigneeUserId: e.target.value })}>
          <option value="">Anyone</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-navy">
          <input type="checkbox" checked={filters.rush} onChange={(e) => set({ rush: e.target.checked })} /> Rush only
        </label>
        <label className="flex items-center gap-1.5 text-sm text-navy">
          Due by
          <input type="date" className={INPUT} value={filters.dueBefore} onChange={(e) => set({ dueBefore: e.target.value })} />
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
      ) : (
        <div className="grid auto-cols-[minmax(250px,1fr)] grid-flow-col gap-4 overflow-x-auto pb-4">
          {LAB_BOARD_COLUMNS.map((status) => (
            <section key={status} className="flex min-h-[200px] flex-col rounded-3xl bg-surface-50 p-3">
              <h2 className="mb-3 flex items-center justify-between px-1 text-[11px] font-mono uppercase tracking-widest text-navy/50">
                {LAB_STATUS_LABELS[status]}
                <span className="rounded-full bg-white px-2 py-0.5 text-navy">{columns[status].length}</span>
              </h2>
              <div className="flex flex-col gap-2">
                {columns[status].map((card) => (
                  <Card key={card.id} card={card} busy={busyId === card.id} onMove={move} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
