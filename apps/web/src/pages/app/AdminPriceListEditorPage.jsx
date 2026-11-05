import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Archive, ArchiveRestore, Loader2, RotateCcw, Percent, Trash2 } from "lucide-react";
import api from "../../config/api.js";
import { ROUTES } from "../../config/routes.js";
import { DataTable } from "../../components/ui/data-table/index.js";
import { ConfirmButton } from "../../components/ui/ConfirmButton.jsx";
import { useToast } from "../../components/ui/Toast.jsx";
import { useDataTable } from "../../hooks/useDataTable.js";
import { eachRow } from "../../lib/data-table/bulk.js";
import { formatCents, parseMoneyInput } from "../../lib/money.js";
import { adjustByPercent, priceDelta } from "../../lib/price-lists.js";
import { errorText } from "../../lib/requests.js";
import { PriceListClientsTab } from "./PriceListClientsTab.jsx";

const INPUT = "h-9 rounded-xl border border-surface-300/60 bg-white px-3 text-sm text-navy focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10";
const getRowId = (r) => r.variantId;
const variantLabel = (r) => `${r.familyName} — ${r.name}`;
const searchFn = (r, q) => `${r.familyName} ${r.name} ${r.code ?? ""}`.toLowerCase().includes(q.toLowerCase());

/** Price cell that edits in place; saves on Enter or blur when the value changed. */
function PriceCell({ row, onSave }) {
  const current = row.listPriceCents == null ? "" : (row.listPriceCents / 100).toFixed(2);
  const [text, setText] = useState(current);
  useEffect(() => setText(current), [current]);
  const commit = () => {
    if (text === current) return;
    const cents = parseMoneyInput(text);
    if (cents == null) { setText(current); return; }
    onSave(row, cents);
  };
  return (
    <input
      aria-label={`List price for ${variantLabel(row)}`}
      value={text}
      placeholder="—"
      inputMode="decimal"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      className={`${INPUT} w-28 text-right`}
    />
  );
}

function columnsFor(onSave) {
  return [
    { id: "family", header: "Family", exportValue: (r) => r.familyName, sortValue: (r) => r.familyName.toLowerCase(), cell: (r) => r.familyName },
    { id: "variant", header: "Variant", exportValue: (r) => r.name, sortValue: (r) => r.name.toLowerCase(), cell: (r) => <span className={r.active ? "" : "text-navy/40"}>{r.name}</span> },
    { id: "code", header: "Code", exportValue: (r) => r.code ?? "", cell: (r) => <span className="text-navy/60">{r.code ?? "—"}</span> },
    { id: "base", header: "Base", align: "right", exportValue: (r) => r.basePriceCents ?? "", sortValue: (r) => r.basePriceCents, cell: (r) => (r.basePriceCents == null ? "—" : formatCents(r.basePriceCents)) },
    { id: "list", header: "List price", align: "right", exportValue: (r) => r.listPriceCents ?? "", sortValue: (r) => r.listPriceCents, cell: (r) => <PriceCell row={r} onSave={onSave} /> },
    {
      id: "delta", header: "Δ base", align: "right", exportValue: (r) => (r.listPriceCents == null ? "" : priceDelta(r.listPriceCents, r.basePriceCents)),
      cell: (r) => <span className="text-xs text-navy/50">{r.listPriceCents == null ? "" : priceDelta(r.listPriceCents, r.basePriceCents)}</span>,
    },
  ];
}

/** Name and description, edited in place; each saves on blur when changed. */
function Header({ list, onPatch }) {
  const [name, setName] = useState(list.name);
  const [description, setDescription] = useState(list.description ?? "");
  const save = (field, value, current) => {
    if (field === "name" && !value) { setName(current); return; } // a list always has a name: revert
    if (value !== current) onPatch({ [field]: value || null });
  };
  return (
    <div className="space-y-2">
      <input aria-label="List name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => save("name", name.trim(), list.name)}
        className={`w-full bg-transparent font-heading text-3xl font-bold tracking-tight text-navy focus:outline-none ${list.archivedAt ? "line-through opacity-60" : ""}`} />
      <input aria-label="Description" placeholder="Add a description" value={description} onChange={(e) => setDescription(e.target.value)}
        onBlur={() => save("description", description.trim(), list.description ?? "")} className="w-full bg-transparent text-sm text-navy/60 focus:outline-none" />
    </div>
  );
}

export function AdminPriceListEditorPage() {
  const { id } = useParams();
  const { addToast } = useToast();
  const [list, setList] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("prices");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [all, items] = await Promise.all([
        api.get("/admin/price-lists", { params: { includeArchived: "1" } }),
        api.get(`/admin/price-lists/${id}/items`),
      ]);
      setList(all.data.data.find((l) => l.id === id) ?? null);
      setRows(items.data.data);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const patchRows = (changes) => setRows((cur) => cur.map((r) => (changes.has(r.variantId) ? { ...r, listPriceCents: changes.get(r.variantId) } : r)));
  const fail = (err) => addToast({ message: errorText(err), type: "error" });

  async function saveOne(row, priceCents) {
    try {
      await api.put(`/admin/price-lists/${id}/items/${row.variantId}`, { priceCents });
      patchRows(new Map([[row.variantId, priceCents]]));
    } catch (err) { fail(err); }
  }

  async function patchList(patch) {
    try {
      await api.patch(`/admin/price-lists/${id}`, patch);
      await load();
    } catch (err) { fail(err); }
  }

  // One items/bulk call; the API accepts up to 500 prices, so larger selections go in chunks.
  async function bulkSet(targets, priceFor) {
    const items = targets.map((r) => ({ variantId: r.variantId, priceCents: priceFor(r) }));
    let ok = 0;
    const failed = [];
    for (let i = 0; i < items.length; i += 500) {
      const chunk = items.slice(i, i + 500);
      try {
        await api.post(`/admin/price-lists/${id}/items/bulk`, { items: chunk });
        ok += chunk.length;
        patchRows(new Map(chunk.map((c) => [c.variantId, c.priceCents])));
      } catch (err) {
        failed.push({ id: `${chunk.length} prices`, message: errorText(err) });
      }
    }
    return { ok, failed };
  }

  const families = useMemo(() => [...new Set(rows.map((r) => r.familyName))].sort(), [rows]);
  const filters = useMemo(() => [
    { id: "priced", label: "Only priced in this list", type: "toggle", match: (r) => r.listPriceCents != null },
    { id: "family", label: "Family", type: "select", placeholder: "All families", options: families.map((f) => ({ value: f, label: f })), match: (r, v) => r.familyName === v },
  ], [families]);

  const table = useDataTable({ mode: "client", rows, searchFn, filters, getRowId, loading, error, reload: load, initialPageSize: 50 });
  const columns = useMemo(() => columnsFor(saveOne), [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = table.selection.count;
  const withBase = (rows_) => rows_.filter((r) => r.basePriceCents != null);
  const priced = (rows_) => rows_.filter((r) => r.listPriceCents != null);
  const bulkActions = [
    {
      id: "base", label: "Set to base price", icon: <RotateCcw size={12} />,
      confirmLabel: `Click again to set ${n} to base`, disabled: (sel) => withBase(sel).length === 0,
      run: (sel) => bulkSet(withBase(sel), (r) => r.basePriceCents),
    },
    {
      id: "adjust", label: (sel, pct) => `Adjust ${priced(sel).length}${pct === undefined ? " by %" : ` by ${pct}%`}`, icon: <Percent size={12} />,
      input: { label: "Adjust by percent", placeholder: "±%", step: "0.1" },
      confirmLabel: (sel, pct) => `Click again to adjust ${priced(sel).length} by ${pct}%`,
      disabled: (sel) => priced(sel).length === 0,
      hint: (sel, pct) => {
        const first = priced(sel)[0];
        return first ? `${formatCents(first.listPriceCents)} → ${formatCents(adjustByPercent(first.listPriceCents, pct))}` : "";
      },
      run: (sel, pct) => bulkSet(priced(sel), (r) => adjustByPercent(r.listPriceCents, pct)),
    },
    {
      id: "remove", label: "Remove from list", icon: <Trash2 size={12} />, tone: "danger",
      confirmLabel: `Click again to remove ${n}`, disabled: (sel) => priced(sel).length === 0,
      run: async (sel) => {
        const result = await eachRow(priced(sel), (r) => api.delete(`/admin/price-lists/${id}/items/${r.variantId}`), variantLabel);
        await load();
        return result;
      },
    },
  ];

  if (!loading && !list && !error) {
    return <div className="mx-auto max-w-7xl px-6 py-8 text-sm text-navy/50">Price list not found. <Link to={ROUTES.ADMIN_PRICE_LISTS} className="text-brand-600 hover:underline">Back to lists</Link></div>;
  }
  return (
    <div className="mx-auto max-w-7xl space-y-5 px-6 py-8">
      <Link to={ROUTES.ADMIN_PRICE_LISTS} className="inline-flex items-center gap-1 text-sm text-navy/50 hover:text-navy"><ArrowLeft size={14} /> Price lists</Link>
      {!list ? <Loader2 className="animate-spin text-navy/40" aria-label="Loading" /> : (
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-[280px] flex-1"><Header key={list.updatedAt} list={list} onPatch={patchList} /></div>
          <div className="flex items-center gap-3 text-xs text-navy/50">
            <span>{rows.filter((r) => r.listPriceCents != null).length} items · {list.clientCount} {list.clientCount === 1 ? "client" : "clients"}</span>
            <ConfirmButton onConfirm={() => patchList({ archived: !list.archivedAt })} confirmLabel={list.archivedAt ? "Click again to restore" : "Click again to archive"}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-surface-100 px-3 text-xs font-semibold text-navy/70 hover:bg-surface-200">
              {list.archivedAt ? <><ArchiveRestore size={12} /> Restore</> : <><Archive size={12} /> Archive</>}
            </ConfirmButton>
          </div>
        </div>
      )}
      {list?.archivedAt && <p className="rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-800">This list is archived. Its prices no longer apply to the clients still assigned to it.</p>}
      <div role="tablist" className="flex gap-1 border-b border-surface-300/50">
        {[{ id: "prices", label: "Prices" }, { id: "clients", label: "Clients on this list" }].map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === t.id ? "border-brand-500 text-navy" : "border-transparent text-navy/50 hover:text-navy"}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "clients" ? <PriceListClientsTab listId={id} /> : <DataTable
        table={table}
        columns={columns}
        bulkActions={bulkActions}
        searchPlaceholder="Family, variant or code"
        itemLabel="variants"
        exportFileName={`${list?.name ?? "price-list"}.csv`}
        emptyText="No variants match."
      />}
    </div>
  );
}
