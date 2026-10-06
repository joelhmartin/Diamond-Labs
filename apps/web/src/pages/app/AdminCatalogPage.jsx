import { useEffect, useMemo, useState } from "react";
import { Search, Loader2, AlertCircle, Plus, Layers, Save } from "lucide-react";
import api from "../../config/api.js";
import { formatCents } from "../../lib/money.js";

const INPUT =
  "w-full px-3.5 py-2.5 rounded-lg bg-white border border-surface-300/60 text-primary text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all placeholder:text-icon";
const CHANNELS = [["all", "All"], ["shop", "Shop"], ["rx", "Lab-billed"], ["both", "Both"]];
// 371+ families: render only the first slice of matches; search narrows the rest.
const LIST_CAP = 200;

/** "$1,234.50" → 123450. "" → null (no price). Anything else → undefined (invalid). */
export function parsePriceInput(str) {
  const s = String(str ?? "").replace(/[$,\s]/g, "");
  if (s === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return undefined;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

export function familyBadge(family) {
  const n = family.variants.length;
  const unpriced = family.variants.filter((v) => v.basePriceCents == null).length;
  return `${n} variant${n === 1 ? "" : "s"}${unpriced ? ` · ${unpriced} unpriced` : ""}`;
}

const errorText = (err) => err.response?.data?.error?.message || "Something went wrong.";

function VariantRow({ family, variant, onSaved }) {
  const labelOf = new Map(family.options.flatMap((o) => o.values.map((v) => [v.id, v.value])));
  const [draft, setDraft] = useState({
    code: variant.code ?? "",
    price: variant.basePriceCents == null ? "" : (variant.basePriceCents / 100).toFixed(2),
    taxable: variant.taxable,
    active: variant.active,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    const basePriceCents = parsePriceInput(draft.price);
    if (basePriceCents === undefined) { setError("Price must be dollars and cents, e.g. 199.00"); return; }
    if (draft.active && basePriceCents == null) { setError("A variant needs a price before it can be active."); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await api.patch(`/admin/catalog/variants/${variant.id}`, {
        code: draft.code.trim() || null, basePriceCents, taxable: draft.taxable, active: draft.active,
      });
      onSaved(res.data.data.family);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="border-t border-surface-300/40 align-top">
      <td className="px-3 py-2 text-sm">
        {variant.optionValueIds.map((id) => labelOf.get(id)).filter(Boolean).join(" · ") || variant.name}
        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      </td>
      <td className="px-3 py-2 w-28"><input className={INPUT} value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} /></td>
      <td className="px-3 py-2 w-32"><input className={INPUT} value={draft.price} placeholder="unpriced" onChange={(e) => setDraft({ ...draft, price: e.target.value })} /></td>
      <td className="px-3 py-2 text-center"><input type="checkbox" checked={draft.taxable} onChange={(e) => setDraft({ ...draft, taxable: e.target.checked })} /></td>
      <td className="px-3 py-2 text-center"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /></td>
      <td className="px-3 py-2">
        <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-40">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
        </button>
      </td>
    </tr>
  );
}

function FamilyDetail({ family, families, onChange }) {
  const [optionName, setOptionName] = useState("");
  const [optionValues, setOptionValues] = useState("");
  const [newValue, setNewValue] = useState({});
  const [mergeSource, setMergeSource] = useState("");
  const [mergePick, setMergePick] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Returns true on success so callers only clear their inputs when the call worked.
  async function act(fn) {
    setBusy(true);
    setError(null);
    try { onChange((await fn()).data.data.family); return true; }
    catch (err) { setError(errorText(err)); return false; }
    finally { setBusy(false); }
  }

  const mergeable = families.filter((f) => f.id !== family.id && f.options.length === 0 && f.variants.length === 1);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-heading font-bold text-xl text-navy">{family.name}</h2>
        <span className="text-xs text-navy/50">{family.channel === "rx" ? "Lab-billed" : family.channel === "both" ? "Shop + lab" : "Shop"}</span>
        <label className="ml-auto text-sm flex items-center gap-2">
          <input type="checkbox" checked={family.active} onChange={(e) => act(() => api.patch(`/admin/catalog/families/${family.id}`, { active: e.target.checked }))} />
          Active
        </label>
      </div>

      {error && <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm flex gap-2"><AlertCircle size={16} />{error}</div>}

      <div className="rounded-xl border border-surface-300/50 overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-surface-50 text-xs text-navy/50 uppercase">
            <tr><th className="px-3 py-2">Variant</th><th className="px-3 py-2">Code</th><th className="px-3 py-2">Base price</th><th className="px-3 py-2">Taxable</th><th className="px-3 py-2">Active</th><th /></tr>
          </thead>
          <tbody>
            {family.variants.map((v) => (
              <VariantRow key={`${v.id}:${v.updatedAt}`} family={family} variant={v} onSaved={onChange} />
            ))}
          </tbody>
        </table>
      </div>

      <section className="space-y-3">
        <h3 className="font-semibold text-sm text-navy">Options</h3>
        {family.options.map((o) => (
          <div key={o.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium w-24">{o.name}</span>
            {o.values.map((v) => <span key={v.id} className="px-2 py-1 rounded-full bg-surface-100">{v.value}</span>)}
            <input className={`${INPUT} w-36`} placeholder={`Add ${o.name.toLowerCase()}`} value={newValue[o.id] ?? ""} onChange={(e) => setNewValue({ ...newValue, [o.id]: e.target.value })} />
            <button type="button" aria-label={`Add ${o.name} value`} disabled={busy || !newValue[o.id]?.trim()} className="text-brand-600 disabled:opacity-40"
              onClick={async () => { if (await act(() => api.post(`/admin/catalog/options/${o.id}/values`, { value: newValue[o.id].trim() }))) setNewValue((nv) => ({ ...nv, [o.id]: "" })); }}>
              <Plus size={16} />
            </button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2 items-center">
          <input className={`${INPUT} w-40`} placeholder="New option (e.g. Size)" value={optionName} onChange={(e) => setOptionName(e.target.value)} />
          <input className={`${INPUT} w-64`} placeholder="Values, comma-separated" value={optionValues} onChange={(e) => setOptionValues(e.target.value)} />
          <button type="button" disabled={busy || !optionName.trim() || !optionValues.trim()} className="px-3 py-2 rounded-lg bg-navy text-white text-sm disabled:opacity-40"
            onClick={async () => {
              const ok = await act(() => api.post(`/admin/catalog/families/${family.id}/options`, {
                name: optionName.trim(), values: optionValues.split(",").map((s) => s.trim()).filter(Boolean),
              }));
              if (ok) { setOptionName(""); setOptionValues(""); }
            }}>
            Add option
          </button>
        </div>
        <p className="text-xs text-navy/50">Adding an option gives existing variants its first value and creates every other combination unpriced and inactive.</p>
      </section>

      {family.options.length > 0 && (
        <section className="space-y-3">
          <h3 className="font-semibold text-sm text-navy flex items-center gap-2"><Layers size={16} /> Merge another product in as a variant</h3>
          <select className={INPUT} value={mergeSource} onChange={(e) => setMergeSource(e.target.value)}>
            <option value="">Choose a single-variant product…</option>
            {mergeable.map((f) => <option key={f.id} value={f.id}>{f.name}{f.variants[0].code ? ` (#${f.variants[0].code})` : ""}</option>)}
          </select>
          <div className="flex flex-wrap gap-2">
            {family.options.map((o) => (
              <select key={o.id} className={`${INPUT} w-48`} value={mergePick[o.id] ?? ""} onChange={(e) => setMergePick({ ...mergePick, [o.id]: e.target.value })}>
                <option value="">{o.name}…</option>
                {o.values.map((v) => <option key={v.id} value={v.id}>{v.value}</option>)}
              </select>
            ))}
          </div>
          <button type="button" className="px-3 py-2 rounded-lg bg-navy text-white text-sm disabled:opacity-40"
            disabled={busy || !mergeSource || family.options.some((o) => !mergePick[o.id])}
            onClick={async () => {
              const ok = await act(() => api.post(`/admin/catalog/families/${family.id}/merge`, {
                sourceFamilyId: mergeSource, optionValueIds: family.options.map((o) => mergePick[o.id]),
              }));
              if (ok) { setMergeSource(""); setMergePick({}); }
            }}>
            Merge
          </button>
        </section>
      )}
    </div>
  );
}

function NewFamilyForm({ onCreated }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function create() {
    setBusy(true);
    setError(null);
    try {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      const res = await api.post("/admin/catalog/families", { name: name.trim(), slug, channel: "shop" });
      onCreated(res.data.data.family);
      setName("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <div className="flex gap-2">
        <input className={INPUT} placeholder="New product name" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="button" aria-label="Create product" disabled={busy || !name.trim()} onClick={create} className="px-3 rounded-lg bg-navy text-white disabled:opacity-40"><Plus size={16} /></button>
      </div>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}

export function AdminCatalogPage() {
  const [families, setFamilies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState("all");
  const [selectedId, setSelectedId] = useState(null);

  async function load({ silent = false } = {}) {
    if (!silent) setLoading(true);
    try {
      const res = await api.get("/admin/catalog/families");
      setFamilies(res.data.data.families);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  function onFamilyChange(updated) {
    setFamilies((fs) => fs.map((f) => (f.id === updated.id ? updated : f)));
    load({ silent: true }); // a merge deletes the source family, so refresh the list too
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return families.filter((f) =>
      (channel === "all" || f.channel === channel) &&
      (!q || f.name.toLowerCase().includes(q) || f.variants.some((v) => (v.code ?? "").toLowerCase().includes(q))));
  }, [families, query, channel]);
  const shown = filtered.slice(0, LIST_CAP);
  const selected = families.find((f) => f.id === selectedId) ?? null;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="font-heading font-bold text-2xl text-navy mb-1">Catalog</h1>
      <p className="text-sm text-navy/50 mb-6">Products, their options and base prices. Client-specific prices live on each client's Pricing page.</p>
      {error && <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>}
      <div className="grid md:grid-cols-[22rem_1fr] gap-6">
        <div className="space-y-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-3 text-navy/30" />
            <input className={`${INPUT} pl-9`} placeholder="Search name or code" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="flex gap-1 flex-wrap">
            {CHANNELS.map(([k, label]) => (
              <button key={k} type="button" onClick={() => setChannel(k)} className={`px-3 py-1 rounded-full text-xs ${channel === k ? "bg-navy text-white" : "bg-surface-100 text-navy/70"}`}>{label}</button>
            ))}
          </div>
          <NewFamilyForm onCreated={(f) => { setFamilies((fs) => [f, ...fs]); setSelectedId(f.id); }} />
          {loading ? (
            <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-navy/40" /></div>
          ) : (
            <>
              <ul className="max-h-[70vh] overflow-y-auto divide-y divide-surface-300/40 rounded-xl border border-surface-300/50">
                {shown.map((f) => (
                  <li key={f.id}>
                    <button type="button" onClick={() => setSelectedId(f.id)} className={`w-full text-left px-3 py-2 ${f.id === selectedId ? "bg-brand-50" : "hover:bg-surface-50"}`}>
                      <span className={`block text-sm ${f.active ? "text-navy" : "text-navy/40 line-through"}`}>{f.name}</span>
                      <span className="block text-xs text-navy/40">{familyBadge(f)}{f.variants.length === 1 && f.variants[0].basePriceCents != null ? ` · ${formatCents(f.variants[0].basePriceCents)}` : ""}</span>
                    </button>
                  </li>
                ))}
                {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-navy/40">No products match.</li>}
              </ul>
              {filtered.length > LIST_CAP && (
                <p className="text-xs text-navy/40">Showing {LIST_CAP} of {filtered.length} matches — refine your search to see the rest.</p>
              )}
            </>
          )}
        </div>
        <div>{selected ? <FamilyDetail family={selected} families={families} onChange={onFamilyChange} /> : <p className="text-sm text-navy/40">Select a product.</p>}</div>
      </div>
    </div>
  );
}
