import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Trash2, CheckCircle } from "lucide-react";
import api from "../../config/api.js";
import { ROUTES } from "../../config/routes.js";
import { formatCents } from "../../lib/money.js";
import { parsePriceInput } from "./AdminCatalogPage.jsx";

const INPUT =
  "w-full px-3.5 py-2.5 rounded-lg bg-white border border-surface-300/60 text-primary text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all placeholder:text-icon";
const errorText = (err) => err.response?.data?.error?.message || "Something went wrong.";

export function priceDelta(priceCents, basePriceCents) {
  if (basePriceCents == null || basePriceCents === 0 || priceCents === basePriceCents) return "";
  const pct = Math.round(((priceCents - basePriceCents) / basePriceCents) * 100);
  return pct < 0 ? `−${Math.abs(pct)}%` : `+${pct}%`;
}

/** Who these prices belong to, for the page header. */
export function clientLabel(users, userId) {
  const u = users.find((x) => x.id === userId);
  if (!u) return null;
  return { name: u.name || u.email, email: u.name ? u.email : null, practice: u.account?.name ?? null };
}

export function AdminClientPricingPage() {
  const { userId } = useParams();
  const [client, setClient] = useState(null);
  const [prices, setPrices] = useState([]);
  const [variants, setVariants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pick, setPick] = useState({ variantId: "", price: "" });

  async function load() {
    setLoading(true);
    try {
      const [p, c] = await Promise.all([
        api.get(`/admin/clients/${userId}/prices`),
        api.get("/admin/catalog/families"),
      ]);
      setPrices(p.data.data.prices);
      setVariants(c.data.data.families.flatMap((f) => f.variants.map((v) => ({ ...v, familyName: f.name }))));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [userId]);

  // The existing admin users list (AdminUsersPage) is the one admin read of a user.
  useEffect(() => {
    setClient(null);
    api.get("/admin/users")
      .then((res) => setClient(clientLabel(res.data.data.users, userId)))
      .catch(() => setClient(null));
  }, [userId]);

  const unreviewed = useMemo(() => prices.filter((p) => !p.reviewedAt), [prices]);

  // Returns true on success. Price mutations return the fresh list; review does not, so reload.
  async function call(fn) {
    setError(null);
    try {
      const res = await fn();
      if (res.data.data.prices) setPrices(res.data.data.prices);
      else await load();
      return true;
    } catch (err) {
      setError(errorText(err));
      return false;
    }
  }

  async function save() {
    const priceCents = parsePriceInput(pick.price);
    if (priceCents == null) { setError("Enter a price in dollars, e.g. 405.00"); return; }
    if (await call(() => api.put(`/admin/clients/${userId}/prices/${pick.variantId}`, { priceCents }))) {
      setPick({ variantId: "", price: "" });
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <Link to={ROUTES.ADMIN_USERS} className="inline-flex items-center gap-1 text-sm text-navy/50 hover:text-navy"><ArrowLeft size={14} /> Users</Link>
      <div>
        <h1 className="font-heading font-bold text-2xl text-navy">Client pricing{client ? ` — ${client.name}` : ""}</h1>
        {client && (
          <p className="text-sm text-navy/50">{[client.email, client.practice].filter(Boolean).join(" · ")}</p>
        )}
      </div>
      {error && <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>}

      {unreviewed.length > 0 && (
        <div className="p-4 rounded-xl bg-amber-50 text-amber-800 text-sm flex flex-wrap items-center gap-3">
          {unreviewed.length} price{unreviewed.length === 1 ? " was" : "s were"} inferred from past invoices and {unreviewed.length === 1 ? "hasn't" : "haven't"} been checked.
          They are already being charged.
          <button type="button" className="ml-auto inline-flex items-center gap-1 font-medium"
            onClick={() => call(() => api.post(`/admin/clients/${userId}/prices/review`, { variantIds: unreviewed.map((p) => p.variantId) }))}>
            <CheckCircle size={16} /> Mark all reviewed
          </button>
        </div>
      )}

      {loading ? <Loader2 className="animate-spin text-navy/40" /> : (
        <table className="w-full text-left rounded-xl border border-surface-300/50 overflow-hidden">
          <thead className="bg-surface-50 text-xs text-navy/50 uppercase">
            <tr><th className="px-3 py-2">Product</th><th className="px-3 py-2">Code</th><th className="px-3 py-2">Base</th><th className="px-3 py-2">Client price</th><th className="px-3 py-2">Source</th><th /></tr>
          </thead>
          <tbody>
            {prices.map((p) => (
              <tr key={p.id} className="border-t border-surface-300/40 text-sm">
                <td className="px-3 py-2">{p.variantName}</td>
                <td className="px-3 py-2 text-navy/60">{p.variantCode ?? "—"}</td>
                <td className="px-3 py-2 text-navy/60">{p.basePriceCents == null ? "—" : formatCents(p.basePriceCents)}</td>
                <td className="px-3 py-2 font-medium">{formatCents(p.priceCents)} <span className="text-xs text-navy/40">{priceDelta(p.priceCents, p.basePriceCents)}</span></td>
                <td className="px-3 py-2 text-xs">{p.source}{!p.reviewedAt && <span className="ml-1 text-amber-600">· unreviewed</span>}</td>
                <td className="px-3 py-2">
                  <button type="button" aria-label="Remove" className="text-navy/40 hover:text-red-600"
                    onClick={() => call(() => api.delete(`/admin/clients/${userId}/prices/${p.variantId}`))}><Trash2 size={16} /></button>
                </td>
              </tr>
            ))}
            {prices.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-navy/40 text-sm">No negotiated prices — this client pays base prices.</td></tr>}
          </tbody>
        </table>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <select className={`${INPUT} md:w-96`} value={pick.variantId} onChange={(e) => setPick({ ...pick, variantId: e.target.value })}>
          <option value="">Set a price for…</option>
          {variants.map((v) => <option key={v.id} value={v.id}>{v.familyName === v.name ? v.name : `${v.familyName} — ${v.name}`}{v.code ? ` (#${v.code})` : ""}</option>)}
        </select>
        <input className={`${INPUT} w-32`} placeholder="0.00" value={pick.price} onChange={(e) => setPick({ ...pick, price: e.target.value })} />
        <button type="button" disabled={!pick.variantId || !pick.price} onClick={save} className="px-4 py-2.5 rounded-lg bg-navy text-white text-sm disabled:opacity-40">Save price</button>
      </div>
    </div>
  );
}
