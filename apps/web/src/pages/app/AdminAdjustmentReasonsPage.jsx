import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { ADJUSTMENT_APPLIES_TO, ADJUSTMENT_APPLIES_LABELS, ADJUSTMENT_LABEL_MAX } from "@my-app/shared";
import api from "../../config/api.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { ConfirmButton } from "../../components/ui/ConfirmButton.jsx";
import { DataTable } from "../../components/ui/data-table/index.js";
import { useDataTable } from "../../hooks/useDataTable.js";
import { errorText } from "../../lib/requests.js";

const INPUT =
  "px-3 py-2 rounded-lg bg-white border border-surface-300/60 text-navy text-sm focus:outline-none focus:border-brand-500";
const BASE = "/admin/lab/adjustment-reasons";

/** "50" -> 50, "" -> null (no default), anything else -> undefined (invalid). */
const parsePercent = (text) => {
  const t = text.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 && n <= 100 ? n : undefined;
};

/**
 * Admin > Reasons: the pick-list behind remake reasons and invoice discounts. Edits save
 * when a field loses focus; a reason is deactivated (never deleted) so past orders keep it.
 * The default percent prices a remake created from the reason (blank = 100% off) and
 * prefills "Add discount".
 */
export function AdminAdjustmentReasonsPage() {
  const { addToast } = useToast();
  const [reasons, setReasons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState({ label: "", appliesTo: "remake", percent: "" });

  const load = useCallback(async () => {
    try {
      const res = await api.get(BASE);
      setReasons(res.data.data.reasons);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const call = useCallback(async (fn, success) => {
    try {
      await fn();
      if (success) addToast({ message: success, type: "success" });
      await load();
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
      await load();
    }
  }, [addToast, load]);

  const patch = useCallback((r, body, success) => call(() => api.patch(`${BASE}/${r.id}`, body), success), [call]);

  const columns = useMemo(() => [
    { id: "position", header: "Order", cell: (r) => (
      <input
        key={`p-${r.id}-${r.position}`} type="number" min={0} max={1000} className={`${INPUT} w-20`} aria-label={`Order of ${r.label}`} defaultValue={r.position}
        onBlur={(e) => Number(e.target.value) !== r.position && patch(r, { position: Number(e.target.value) })}
      />
    ) },
    { id: "label", header: "Reason", cell: (r) => (
      <input
        key={`l-${r.id}-${r.label}`} className={`${INPUT} w-full min-w-[12rem]`} aria-label={`Label of ${r.label}`} maxLength={ADJUSTMENT_LABEL_MAX} defaultValue={r.label}
        onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== r.label) patch(r, { label: v }); }}
      />
    ) },
    { id: "appliesTo", header: "Used for", cell: (r) => (
      <select className={INPUT} aria-label={`Used for ${r.label}`} value={r.appliesTo} onChange={(e) => patch(r, { appliesTo: e.target.value })}>
        {ADJUSTMENT_APPLIES_TO.map((a) => <option key={a} value={a}>{ADJUSTMENT_APPLIES_LABELS[a]}</option>)}
      </select>
    ) },
    { id: "percent", header: "Default % off", cell: (r) => (
      <input
        key={`d-${r.id}-${r.discountPercent}`} className={`${INPUT} w-24`} inputMode="numeric" placeholder="none" aria-label={`Default percent of ${r.label}`} defaultValue={r.discountPercent ?? ""}
        onBlur={(e) => {
          const v = parsePercent(e.target.value);
          if (v === undefined) { addToast({ message: "A percent is a whole number from 0 to 100.", type: "error" }); load(); return; }
          if (v !== r.discountPercent) patch(r, { discountPercent: v });
        }}
      />
    ) },
    { id: "active", header: "", export: false, align: "right", cell: (r) => (r.active ? (
      <ConfirmButton className="rounded-full px-3 py-1.5 text-xs font-semibold text-red-600" confirmLabel="Click again to deactivate" onConfirm={() => patch(r, { active: false }, `${r.label} deactivated.`)}>
        Deactivate
      </ConfirmButton>
    ) : (
      <button type="button" className="rounded-full px-3 py-1.5 text-xs font-semibold text-brand-700 hover:underline" onClick={() => patch(r, { active: true }, `${r.label} reactivated.`)}>
        Reactivate
      </button>
    )) },
  ], [patch, addToast, load]);

  const table = useDataTable({
    mode: "client", rows: reasons, loading, error, reload: load, initialPageSize: 1000,
    searchFn: (r, q) => r.label.toLowerCase().includes(q.toLowerCase()),
  });

  const add = (e) => {
    e.preventDefault();
    const label = draft.label.trim();
    const percent = parsePercent(draft.percent);
    if (!label) return;
    if (percent === undefined) { addToast({ message: "A percent is a whole number from 0 to 100.", type: "error" }); return; }
    call(async () => {
      await api.post(BASE, { label, appliesTo: draft.appliesTo, discountPercent: percent, position: reasons.length * 10 + 10 });
      setDraft({ label: "", appliesTo: draft.appliesTo, percent: "" });
    }, "Reason added.");
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6 md:p-8">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Remake and discount reasons</h1>
        <p className="mt-1 text-sm text-navy/50">
          The list staff pick from when remaking an order or discounting an invoice. A remake priced from a reason takes its
          default percent off (blank means free). Deactivate a reason instead of deleting it — past orders keep it.
        </p>
      </div>
      <DataTable
        table={table} columns={columns} selectable={false} exportable={false} paginated={false}
        searchPlaceholder="Search reasons" itemLabel="reasons" emptyText="No reasons yet."
      />
      <form onSubmit={add} className="flex flex-wrap gap-2">
        <input className={`${INPUT} min-w-[12rem] flex-1`} placeholder="e.g. Lab error" aria-label="New reason" maxLength={ADJUSTMENT_LABEL_MAX} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
        <select className={INPUT} aria-label="New reason used for" value={draft.appliesTo} onChange={(e) => setDraft({ ...draft, appliesTo: e.target.value })}>
          {ADJUSTMENT_APPLIES_TO.map((a) => <option key={a} value={a}>{ADJUSTMENT_APPLIES_LABELS[a]}</option>)}
        </select>
        <input className={`${INPUT} w-28`} inputMode="numeric" placeholder="% off" aria-label="New reason default percent" value={draft.percent} onChange={(e) => setDraft({ ...draft, percent: e.target.value })} />
        <button type="submit" disabled={!draft.label.trim()} className="flex items-center gap-1 rounded-lg bg-navy px-4 py-2 text-sm text-white disabled:opacity-40"><Plus size={14} /> Add</button>
      </form>
    </div>
  );
}
