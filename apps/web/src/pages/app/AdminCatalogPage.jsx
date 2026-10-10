import { useEffect, useMemo, useState } from "react";
import { Search, Loader2, AlertCircle, Plus, Layers, Save, Pencil, Trash2, X, Check } from "lucide-react";
import { canDeleteVariant, canDeleteOptionValue } from "@my-app/shared";
import api from "../../config/api.js";
import { formatCents } from "../../lib/money.js";
import ImageUploadField from "../../components/ui/ImageUploadField.jsx";

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

/** Whether a variant may be saved as active. Shop items need a base price; lab-billed (rx) items
 * can be billed from a client's negotiated price alone. Returns { ok, note }. */
export function canActivate(family, variant, priceCents) {
  if (priceCents != null) return { ok: true, note: null };
  if (family.channel === "rx") {
    return { ok: true, note: "No base price — only clients with a negotiated price can be billed." };
  }
  return { ok: false, note: "A variant needs a price before it can be active." };
}

/** The API's own deletion rule, fed the usage counts the admin catalog carries. */
export function variantDeleteCheck(family, variant) {
  return canDeleteVariant({
    variant, clientPriceCount: variant.clientPriceCount, orderItemCount: variant.orderItemCount,
    familyVariantCount: family.variants.length,
  });
}

export function valueDeleteCheck(family, option, valueId) {
  return canDeleteOptionValue({
    optionValueCount: option.values.length,
    variants: family.variants.filter((v) => v.optionValueIds.includes(valueId)),
  });
}

const errorText = (err) => err.response?.data?.error?.message || "Something went wrong.";

/** Text with a pencil; click to edit in place. onSave returns true on success. */
function InlineRename({ value, label, onSave, busy, className = "" }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (!editing) {
    return (
      <span className={`inline-flex items-center gap-1 ${className}`}>
        {value}
        <button type="button" aria-label={`Rename ${label}`} title={`Rename ${label}`} className="text-navy/30 hover:text-navy"
          onClick={() => { setDraft(value); setEditing(true); }}>
          <Pencil size={12} />
        </button>
      </span>
    );
  }
  const save = async () => { if (await onSave(draft.trim())) setEditing(false); };
  return (
    <span className="inline-flex items-center gap-1">
      <input className={`${INPUT} w-36 py-1`} aria-label={`New name for ${label}`} value={draft} autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) save(); if (e.key === "Escape") setEditing(false); }} />
      <button type="button" aria-label="Save name" disabled={busy || !draft.trim() || draft.trim() === value} className="text-brand-600 disabled:opacity-40" onClick={save}><Check size={14} /></button>
      <button type="button" aria-label="Cancel rename" className="text-navy/40" onClick={() => setEditing(false)}><X size={14} /></button>
    </span>
  );
}

/** Delete with an inline "Confirm delete?" step; disabled with the reason when the API would refuse. */
function DeleteControl({ check, label, onConfirm, busy }) {
  const [confirming, setConfirming] = useState(false);
  if (!check.ok) {
    return (
      <button type="button" disabled aria-label={`Delete ${label}`} title={`Can't delete: ${check.reason}`} className="text-navy/20 cursor-not-allowed">
        <Trash2 size={14} />
      </button>
    );
  }
  if (!confirming) {
    return (
      <button type="button" aria-label={`Delete ${label}`} title={`Delete ${label}`} className="text-navy/40 hover:text-red-600" onClick={() => setConfirming(true)}>
        <Trash2 size={14} />
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className="text-red-600">Confirm delete?</span>
      <button type="button" disabled={busy} className="font-semibold text-red-600 disabled:opacity-40" onClick={async () => { if (!(await onConfirm())) setConfirming(false); }}>Yes</button>
      <button type="button" className="text-navy/50" onClick={() => setConfirming(false)}>No</button>
    </span>
  );
}

function VariantRow({ family, variant, onSaved, act, busy }) {
  const labelOf = new Map(family.options.flatMap((o) => o.values.map((v) => [v.id, v.value])));
  const [draft, setDraft] = useState({
    name: variant.name ?? "",
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
    if (!draft.name.trim()) { setError("A variant needs a name."); return; }
    if (draft.active) {
      const gate = canActivate(family, variant, basePriceCents);
      if (!gate.ok) { setError(gate.note); return; }
    }
    setSaving(true);
    setError(null);
    try {
      const res = await api.patch(`/admin/catalog/variants/${variant.id}`, {
        name: draft.name.trim(), code: draft.code.trim() || null, basePriceCents, taxable: draft.taxable, active: draft.active,
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
        <span className="block text-xs text-navy/50 mb-1">{variant.optionValueIds.map((id) => labelOf.get(id)).filter(Boolean).join(" · ") || "Default"}</span>
        <input className={INPUT} aria-label="Variant name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        {variant.active && variant.basePriceCents == null && canActivate(family, variant, null).note && family.channel === "rx" && <p className="text-xs text-amber-700 mt-1">{canActivate(family, variant, null).note}</p>}
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
        <div className="mt-2">
          <DeleteControl check={variantDeleteCheck(family, variant)} label={variant.name} busy={busy}
            onConfirm={() => act(() => api.delete(`/admin/catalog/variants/${variant.id}`))} />
        </div>
      </td>
    </tr>
  );
}

const CHANNEL_OPTIONS = [["shop", "Shop"], ["rx", "Lab-billed"], ["both", "Both"]];

function DetailsForm({ family, busy, act }) {
  const [d, setD] = useState({
    name: family.name ?? "", category: family.category ?? "", description: family.description ?? "",
    imageUrl: family.imageUrl ?? "", channel: family.channel,
  });
  const [localError, setLocalError] = useState(null);
  const set = (k) => (e) => setD({ ...d, [k]: e.target.value });
  function save() {
    if (!d.name.trim()) { setLocalError("A product needs a name."); return; }
    setLocalError(null);
    act(() => api.patch(`/admin/catalog/families/${family.id}`, {
      name: d.name.trim(), category: d.category.trim() || null, description: d.description.trim() || null,
      imageUrl: d.imageUrl.trim() || null, channel: d.channel,
    }));
  }
  return (
    <details className="rounded-xl border border-surface-300/50 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-navy">Details</summary>
      <div className="grid sm:grid-cols-2 gap-3 mt-3">
        <input className={INPUT} aria-label="Name" placeholder="Name" value={d.name} onChange={set("name")} />
        <input className={INPUT} aria-label="Category" placeholder="Category" value={d.category} onChange={set("category")} />
        <select className={INPUT} aria-label="Channel" value={d.channel} onChange={set("channel")}>
          {CHANNEL_OPTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <div className="sm:col-span-2">
          <ImageUploadField label="Image" value={d.imageUrl} onChange={(url) => setD((prev) => ({ ...prev, imageUrl: url }))} />
        </div>
        <textarea className={`${INPUT} sm:col-span-2`} aria-label="Description" placeholder="Description" rows={3} value={d.description} onChange={set("description")} />
      </div>
      {localError && <p className="text-xs text-red-600 mt-2">{localError}</p>}
      <button type="button" disabled={busy} onClick={save} className="mt-3 px-3 py-2 rounded-lg bg-navy text-white text-sm disabled:opacity-40">Save details</button>
    </details>
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

  const [mergeFilter, setMergeFilter] = useState("");
  const mf = mergeFilter.trim().toLowerCase();
  const mergeable = families.filter((f) => f.id !== family.id && f.options.length === 0 && f.variants.length === 1
    && (!mf || f.name.toLowerCase().includes(mf) || (f.variants[0].code ?? "").toLowerCase().includes(mf)));

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

      <DetailsForm family={family} busy={busy} act={act} />

      <div className="rounded-xl border border-surface-300/50 overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-surface-50 text-xs text-navy/50 uppercase">
            <tr><th className="px-3 py-2">Variant</th><th className="px-3 py-2">Code</th><th className="px-3 py-2">Base price</th><th className="px-3 py-2">Taxable</th><th className="px-3 py-2">Active</th><th /></tr>
          </thead>
          <tbody>
            {family.variants.map((v) => (
              <VariantRow key={`${v.id}:${v.updatedAt}`} family={family} variant={v} onSaved={onChange} act={act} busy={busy} />
            ))}
          </tbody>
        </table>
      </div>

      <section className="space-y-3">
        <h3 className="font-semibold text-sm text-navy">Options</h3>
        {family.options.map((o) => (
          <div key={o.id} className="flex flex-wrap items-center gap-2 text-sm">
            <InlineRename className="font-medium min-w-[6rem]" value={o.name} label={o.name} busy={busy}
              onSave={(name) => act(() => api.patch(`/admin/catalog/options/${o.id}`, { name }))} />
            {o.values.map((v) => (
              <span key={v.id} className="px-2 py-1 rounded-full bg-surface-100 inline-flex items-center gap-1">
                <InlineRename value={v.value} label={`${o.name} ${v.value}`} busy={busy}
                  onSave={(value) => act(() => api.patch(`/admin/catalog/option-values/${v.id}`, { value }))} />
                <DeleteControl check={valueDeleteCheck(family, o, v.id)} label={`${o.name} ${v.value}`} busy={busy}
                  onConfirm={() => act(() => api.delete(`/admin/catalog/option-values/${v.id}`))} />
              </span>
            ))}
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
        <p className="text-xs text-navy/50">Adding an option gives existing variants its first value and creates every other combination unpriced and inactive.
          Only blank variants (inactive, unpriced, no code, no client prices, never ordered) can be deleted; deleting a value deletes its variants.</p>
      </section>

      {family.options.length === 0 && (
        <p className="text-xs text-navy/50">Add an option first to merge other products in as variants.</p>
      )}
      {family.options.length > 0 && (
        <section className="space-y-3">
          <h3 className="font-semibold text-sm text-navy flex items-center gap-2"><Layers size={16} /> Merge another product in as a variant</h3>
          <input className={INPUT} placeholder="Filter products to merge" value={mergeFilter} onChange={(e) => setMergeFilter(e.target.value)} />
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
  const [channel, setChannel] = useState("shop");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function create() {
    setBusy(true);
    setError(null);
    try {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      const res = await api.post("/admin/catalog/families", { name: name.trim(), slug, channel });
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
      <select className={`${INPUT} mt-2`} aria-label="New product channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
        {CHANNEL_OPTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
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
      setError(null);
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
        <div>{selected ? <FamilyDetail key={selected.id} family={selected} families={families} onChange={onFamilyChange} /> : <p className="text-sm text-navy/40">Select a product.</p>}</div>
      </div>
    </div>
  );
}
