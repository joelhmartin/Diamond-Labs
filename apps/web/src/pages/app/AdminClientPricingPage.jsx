import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle, Copy, Trash2 } from "lucide-react";
import api from "../../config/api.js";
import { ROUTES } from "../../config/routes.js";
import { DataTable, summarizeResult } from "../../components/ui/data-table/index.js";
import { CopyPricesModal } from "../../components/admin/CopyPricesModal.jsx";
import { ConfirmButton } from "../../components/ui/ConfirmButton.jsx";
import { useToast } from "../../components/ui/Toast.jsx";
import { useDataTable } from "../../hooks/useDataTable.js";
import { eachRow } from "../../lib/data-table/bulk.js";
import { formatCents, parseMoneyInput } from "../../lib/money.js";
import { priceDelta, sourceChip } from "../../lib/price-lists.js";
import { errorText } from "../../lib/requests.js";
import { AssignedListsStrip } from "./AssignedListsStrip.jsx";

export { priceDelta };

const INPUT =
  "w-full px-3.5 py-2.5 rounded-lg bg-white border border-surface-300/60 text-primary text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all placeholder:text-icon";
const getRowId = (r) => r.variantId;
const searchFn = (r, q) => `${r.familyName ?? ""} ${r.variantName} ${r.variantCode ?? ""}`.toLowerCase().includes(q.toLowerCase());
const CHIP_TONE = {
  client: "bg-navy/10 text-navy",
  list: "bg-brand-500/10 text-brand-700",
  base: "bg-surface-200 text-navy/60",
};

/** Who these prices belong to, for the page header. */
export function clientLabel(users, userId) {
  const u = users.find((x) => x.id === userId);
  if (!u) return null;
  return { name: u.name || u.email, email: u.name ? u.email : null, practice: u.account?.name ?? null };
}

/**
 * One row per variant that has a client price or a list price. `overrides` are the client's own
 * rows (each carries `listPriceCents`, what the client's lists alone would charge, from the server),
 * `effective` what the shop charges (client beats list). An override equal to its list price is
 * flagged "Same as list".
 */
export function buildPriceRows({ prices, effective }) {
  const overrides = new Map(prices.map((p) => [p.variantId, p]));
  const eff = new Map(effective.map((e) => [e.variantId, e]));
  const ids = new Set([...overrides.keys(), ...eff.keys()]);
  return [...ids].map((variantId) => {
    const o = overrides.get(variantId);
    const e = eff.get(variantId);
    const cents = e?.cents ?? o.priceCents;
    return {
      variantId,
      variantName: e?.variantName ?? o.variantName,
      variantCode: e?.variantCode ?? o.variantCode ?? null,
      familyName: e?.familyName ?? null,
      basePriceCents: e?.basePriceCents ?? o.basePriceCents ?? null,
      cents,
      source: e?.source ?? "client",
      listName: e?.listName ?? null,
      override: o ?? null,
      unreviewed: Boolean(o) && !o.reviewedAt,
      sameAsList: Boolean(o) && o.listPriceCents != null && o.listPriceCents === o.priceCents,
    };
  }).sort((a, b) => (a.familyName ?? "").localeCompare(b.familyName ?? "") || a.variantName.localeCompare(b.variantName));
}

function columnsFor(removeOne) {
  return [
    {
      id: "product", header: "Product", exportValue: (r) => r.variantName, sortValue: (r) => r.variantName.toLowerCase(),
      cell: (r) => <>{r.familyName && r.familyName !== r.variantName ? <span className="text-navy/40">{r.familyName} — </span> : null}{r.variantName}</>,
    },
    { id: "code", header: "Code", exportValue: (r) => r.variantCode ?? "", cell: (r) => <span className="text-navy/60">{r.variantCode ?? "—"}</span> },
    { id: "base", header: "Base", align: "right", exportValue: (r) => r.basePriceCents ?? "", sortValue: (r) => r.basePriceCents, cell: (r) => <span className="text-navy/60">{r.basePriceCents == null ? "—" : formatCents(r.basePriceCents)}</span> },
    {
      id: "price", header: "Client price", align: "right", exportValue: (r) => r.cents, sortValue: (r) => r.cents,
      cell: (r) => <span className="font-medium">{formatCents(r.cents)} <span className="text-xs font-normal text-navy/40">{priceDelta(r.cents, r.basePriceCents)}</span></span>,
    },
    {
      id: "source", header: "Source", exportValue: (r) => sourceChip({ source: r.source, listName: r.listName }).label,
      cell: (r) => {
        const chip = sourceChip({ source: r.source, listName: r.listName });
        return (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className={`rounded-full px-2 py-0.5 font-semibold ${CHIP_TONE[chip.tone]}`}>{chip.label}</span>
            {r.override && r.override.source !== "manual" && <span className="text-navy/40">{r.override.source}</span>}
            {r.sameAsList && <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-700">Same as list</span>}
            {r.unreviewed && <span className="text-amber-600">unreviewed</span>}
          </div>
        );
      },
    },
    {
      id: "actions", header: "", align: "right", exportValue: () => "",
      cell: (r) => r.override && (
        <ConfirmButton onConfirm={() => removeOne(r)} confirmLabel="Click again to remove"
          className="rounded-md p-1 text-navy/40 hover:text-red-600"><Trash2 size={16} aria-label="Remove client price" /></ConfirmButton>
      ),
    },
  ];
}

/** Everything the page shows, fetched together and refreshed after any change. */
function useClientPricing(userId) {
  const [state, setState] = useState({ prices: [], effective: [], assigned: [], allLists: [], variants: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, c, a, all] = await Promise.all([
        api.get(`/admin/clients/${userId}/prices`),
        api.get("/admin/catalog/families"),
        api.get(`/admin/clients/${userId}/price-lists`),
        api.get("/admin/price-lists"),
      ]);
      const assigned = a.data.data;
      setState({
        prices: p.data.data.prices,
        effective: p.data.data.effective ?? [],
        assigned,
        allLists: all.data.data,
        variants: c.data.data.families.flatMap((f) => f.variants.map((v) => ({ ...v, familyName: f.name }))),
      });
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [userId]);
  useEffect(() => { load(); }, [load]);
  return { ...state, loading, error, load };
}

export function AdminClientPricingPage() {
  const { userId } = useParams();
  const { addToast } = useToast();
  const [client, setClient] = useState(null);
  const [pick, setPick] = useState({ variantId: "", price: "" });
  const [copyOpen, setCopyOpen] = useState(false);
  const data = useClientPricing(userId);

  // The existing admin users list (AdminUsersPage) is the one admin read of a user.
  useEffect(() => {
    setClient(null);
    api.get("/admin/users")
      .then((res) => setClient(clientLabel(res.data.data.users, userId)))
      .catch(() => setClient(null));
  }, [userId]);

  const rows = useMemo(() => buildPriceRows(data), [data.prices, data.effective]); // eslint-disable-line react-hooks/exhaustive-deps
  const unreviewed = useMemo(() => rows.filter((r) => r.unreviewed), [rows]);
  const filters = useMemo(() => [
    { id: "source", label: "Source", type: "select", placeholder: "All sources", options: [{ value: "client", label: "Client" }, { value: "list", label: "List" }], match: (r, v) => r.source === v },
    { id: "same", label: "Same as list", type: "toggle", match: (r) => r.sameAsList },
    { id: "unreviewed", label: "Unreviewed", type: "toggle", match: (r) => r.unreviewed },
  ], []);

  const report = (message, type = "error") => addToast({ message, type });
  async function run(fn) {
    try {
      await fn();
      await data.load();
      return true;
    } catch (err) {
      report(errorText(err));
      return false;
    }
  }

  const removeOne = (r) => run(() => api.delete(`/admin/clients/${userId}/prices/${r.variantId}`));
  const review = (ids) => run(() => api.post(`/admin/clients/${userId}/prices/review`, { variantIds: ids }));
  const columns = useMemo(() => columnsFor(removeOne), [userId]); // eslint-disable-line react-hooks/exhaustive-deps
  const table = useDataTable({ mode: "client", rows, searchFn, filters, getRowId, loading: data.loading, error: data.error, reload: data.load, initialPageSize: 50 });

  const n = table.selection.count;
  const own = (sel) => sel.filter((r) => r.override);
  const bulkActions = [
    {
      id: "review", label: "Mark reviewed", icon: <CheckCircle size={12} />, disabled: (sel) => !sel.some((r) => r.unreviewed),
      run: (sel) => review(sel.filter((r) => r.unreviewed).map((r) => r.variantId)),
    },
    {
      id: "remove", label: "Remove client price", icon: <Trash2 size={12} />, tone: "danger", confirmLabel: `Click again to remove ${n}`,
      disabled: (sel) => own(sel).length === 0,
      run: async (sel) => {
        const result = await eachRow(own(sel), (r) => api.delete(`/admin/clients/${userId}/prices/${r.variantId}`), (r) => r.variantName);
        await data.load();
        return result;
      },
    },
  ];

  const copyDone = async (result) => {
    addToast({ message: summarizeResult(result), type: result.failed?.length ? "warning" : "success" });
    setCopyOpen(false);
    await data.load();
  };

  async function save() {
    const priceCents = parseMoneyInput(pick.price);
    if (priceCents == null) { report("Enter a price in dollars, e.g. 405.00"); return; }
    if (await run(() => api.put(`/admin/clients/${userId}/prices/${pick.variantId}`, { priceCents }))) setPick({ variantId: "", price: "" });
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <Link to={ROUTES.ADMIN_USERS} className="inline-flex items-center gap-1 text-sm text-navy/50 hover:text-navy"><ArrowLeft size={14} /> Users</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading font-bold text-2xl text-navy">Client pricing{client ? ` — ${client.name}` : ""}</h1>
          {client && <p className="text-sm text-navy/50">{[client.email, client.practice].filter(Boolean).join(" · ")}</p>}
        </div>
        <button type="button" onClick={() => setCopyOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-surface-300/60 bg-white px-3.5 py-2 text-sm text-navy hover:bg-surface-100">
          <Copy size={14} /> Copy prices from…
        </button>
      </div>
      {copyOpen && <CopyPricesModal targetIds={[userId]} onDone={copyDone} onClose={() => setCopyOpen(false)} />}

      <AssignedListsStrip userId={userId} assigned={data.assigned} allLists={data.allLists} onChanged={data.load} />

      {unreviewed.length > 0 && (
        <div className="p-4 rounded-xl bg-amber-50 text-amber-800 text-sm flex flex-wrap items-center gap-3">
          {unreviewed.length} price{unreviewed.length === 1 ? " was" : "s were"} inferred from past invoices and {unreviewed.length === 1 ? "hasn't" : "haven't"} been checked.
          They are already being charged.
          <button type="button" className="ml-auto inline-flex items-center gap-1 font-medium" onClick={() => review(unreviewed.map((r) => r.variantId))}>
            <CheckCircle size={16} /> Mark all reviewed
          </button>
        </div>
      )}

      <DataTable
        table={table}
        columns={columns}
        bulkActions={bulkActions}
        searchPlaceholder="Product or code"
        itemLabel="prices"
        exportFileName="client-prices.csv"
        emptyText="No negotiated prices. This client pays base prices."
      />

      <div className="flex flex-wrap gap-2 items-center">
        <select aria-label="Variant" className={`${INPUT} md:w-96`} value={pick.variantId} onChange={(e) => setPick({ ...pick, variantId: e.target.value })}>
          <option value="">Set a price for…</option>
          {data.variants.map((v) => <option key={v.id} value={v.id}>{v.familyName === v.name ? v.name : `${v.familyName} — ${v.name}`}{v.code ? ` (#${v.code})` : ""}</option>)}
        </select>
        <input aria-label="Price" className={`${INPUT} w-32`} placeholder="0.00" value={pick.price} onChange={(e) => setPick({ ...pick, price: e.target.value })} />
        <button type="button" disabled={!pick.variantId || !pick.price} onClick={save} className="px-4 py-2.5 rounded-lg bg-navy text-white text-sm disabled:opacity-40">Save price</button>
      </div>
    </div>
  );
}
