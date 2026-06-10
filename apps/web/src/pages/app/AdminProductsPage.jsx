import { useEffect, useMemo, useState } from "react";
import {
  Search,
  RefreshCw,
  Loader2,
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Package,
  Edit3,
  X,
  Save,
  Eye,
  EyeOff,
  Link2,
  Link2Off,
  Info,
} from "lucide-react";
import api from "../../config/api.js";
import { SEED_CATALOG } from "../../data/catalog.js";

const INPUT =
  "w-full px-3.5 py-2.5 rounded-lg bg-white border border-surface-300/60 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all placeholder:text-navy/25";

// Catalog SKUs an admin can map a Seazona product to. Sorted by name for the
// picker; we keep id around for display + value.
const CATALOG_OPTIONS = SEED_CATALOG
  .map((p) => ({ id: p.id, name: p.name }))
  .sort((a, b) => a.name.localeCompare(b.name));

const CATALOG_NAME_BY_ID = Object.fromEntries(
  SEED_CATALOG.map((p) => [p.id, p.name]),
);

function formatPrice(p) {
  if (p === null || p === undefined || p === "") return "—";
  const n = Number(p);
  if (!Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

function formatDate(d) {
  if (!d) return "Never";
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function Stat({ label, value, tint = "text-navy" }) {
  return (
    <div className="bg-white rounded-2xl border border-surface-300/50 p-4">
      <div className={`font-heading font-bold text-2xl tracking-tight ${tint}`}>{value}</div>
      <div className="text-[10px] font-mono text-navy/40 uppercase tracking-widest mt-0.5">{label}</div>
    </div>
  );
}

function Th({ children, className = "" }) {
  return (
    <th className={`text-left px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-navy/40 font-normal ${className}`}>
      {children}
    </th>
  );
}

function Toast({ tone, children, onDismiss }) {
  return (
    <div
      className={`fixed bottom-6 right-6 z-[9999] px-4 py-3 rounded-xl shadow-xl shadow-navy/20 flex items-center gap-2 text-sm ${
        tone === "error" ? "bg-red-500 text-white" : "bg-emerald-500 text-white"
      }`}
    >
      {tone === "error" ? <AlertCircle size={14} /> : <CheckCircle size={14} />}
      <span>{children}</span>
      <button onClick={onDismiss} className="ml-2 opacity-80 hover:opacity-100">
        <XCircle size={14} />
      </button>
    </div>
  );
}

/* ─── EDIT MODAL ─── */
// Only shop-local fields are editable here. Seazona-authoritative fields
// (code / name / taxable / price) are shown read-only — they come from sync.
function ProductEditor({ product, onClose, onSave, saving }) {
  const [draft, setDraft] = useState({
    purchasable: product.purchasable ?? false,
    catalogId: product.catalogId ?? "",
    imageUrl: product.imageUrl ?? "",
    description: product.description ?? "",
    category: product.category ?? "",
  });

  const update = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  function save() {
    onSave(product.seazonaProductId, {
      purchasable: draft.purchasable,
      catalogId: draft.catalogId ? draft.catalogId : null,
      imageUrl: draft.imageUrl,
      description: draft.description,
      category: draft.category,
    });
  }

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-end md:items-center justify-center p-0 md:p-6 bg-navy/50 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl bg-white md:rounded-[2rem] rounded-t-[2rem] p-6 md:p-8 shadow-2xl max-h-[95dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="font-heading font-bold text-xl text-navy">Edit product</h2>
            <p className="text-xs text-navy/40 mt-0.5 font-mono">{product.seazonaProductId}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-surface-100 hover:bg-surface-200 flex items-center justify-center text-navy/60"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Seazona-authoritative (read-only) */}
        <div className="rounded-2xl bg-surface-100/70 border border-surface-300/40 p-4 mb-6">
          <div className="text-[10px] font-mono text-navy/40 uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <Info size={11} /> From Seazona — read-only
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-[10px] text-navy/40">Name</div>
              <div className="font-medium text-navy truncate">{product.name || "—"}</div>
            </div>
            <div>
              <div className="text-[10px] text-navy/40">Code</div>
              <div className="font-mono text-navy/80">{product.code || "—"}</div>
            </div>
            <div>
              <div className="text-[10px] text-navy/40">Price</div>
              <div className="font-medium text-navy">{formatPrice(product.price)}</div>
            </div>
            <div>
              <div className="text-[10px] text-navy/40">Taxable</div>
              <div className="font-medium text-navy">{product.taxable ? "Yes" : "No"}</div>
            </div>
          </div>
        </div>

        {/* Shop-local (editable) */}
        <div className="space-y-4">
          {/* Purchasable toggle */}
          <button
            type="button"
            onClick={() => update("purchasable", !draft.purchasable)}
            className={`flex items-center gap-3 w-full p-3 rounded-xl border transition-all ${
              draft.purchasable
                ? "bg-emerald-500/5 border-emerald-500/30"
                : "bg-navy/5 border-navy/20"
            }`}
          >
            <div className={`w-10 h-6 rounded-full transition-colors relative ${draft.purchasable ? "bg-emerald-500" : "bg-navy/30"}`}>
              <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${draft.purchasable ? "left-[18px]" : "left-0.5"}`} />
            </div>
            <div className="flex-1 text-left">
              <div className="text-sm font-semibold text-navy">
                {draft.purchasable ? "Shoppable — appears in the shop" : "Not shoppable — hidden from the shop"}
              </div>
              <div className="text-xs text-navy/40">
                A product must also be mapped to a catalog SKU to render correctly.
              </div>
            </div>
          </button>

          {/* Catalog mapping */}
          <div>
            <label className="block text-[10px] font-mono text-navy/40 uppercase tracking-widest mb-1.5">
              Catalog SKU mapping
            </label>
            <select
              className={INPUT}
              value={draft.catalogId}
              onChange={(e) => update("catalogId", e.target.value)}
            >
              <option value="">— Not mapped —</option>
              {CATALOG_OPTIONS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.id})
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[11px] text-navy/40">
              Links this Seazona product to one of the {CATALOG_OPTIONS.length} shop catalog SKUs.
            </p>
          </div>

          <div>
            <label className="block text-[10px] font-mono text-navy/40 uppercase tracking-widest mb-1.5">
              Category (shop)
            </label>
            <input
              className={INPUT}
              value={draft.category}
              onChange={(e) => update("category", e.target.value)}
              placeholder="Tools, Sleep, Products…"
            />
          </div>

          <div>
            <label className="block text-[10px] font-mono text-navy/40 uppercase tracking-widest mb-1.5">
              Image URL (shop)
            </label>
            <input
              className={INPUT}
              value={draft.imageUrl}
              onChange={(e) => update("imageUrl", e.target.value)}
              placeholder="/catalog/product.webp or full URL"
            />
          </div>

          <div>
            <label className="block text-[10px] font-mono text-navy/40 uppercase tracking-widest mb-1.5">
              Description (shop)
            </label>
            <textarea
              rows={3}
              className={`${INPUT} resize-none`}
              value={draft.description}
              onChange={(e) => update("description", e.target.value)}
            />
          </div>
        </div>

        <div className="mt-8 flex items-center justify-end gap-2 pt-5 border-t border-surface-300/30">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-full text-sm font-medium text-navy/60 hover:bg-surface-100 transition-all"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 transition-colors disabled:opacity-60"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── MAIN PAGE ─── */
export function AdminProductsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState({ products: [], summary: null });
  const [query, setQuery] = useState("");
  const [purchasableOnly, setPurchasableOnly] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState(null);

  const load = async () => {
    try {
      const res = await api.get("/admin/products");
      setData(res.data.data);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message || "Failed to load products.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.products.filter((p) => {
      if (purchasableOnly && !p.purchasable) return false;
      if (!q) return true;
      const blob = [
        p.name, p.code, p.catalogId,
        p.catalogId ? CATALOG_NAME_BY_ID[p.catalogId] : "",
        p.category,
      ].filter(Boolean).join(" ").toLowerCase();
      return blob.includes(q);
    });
  }, [data.products, query, purchasableOnly]);

  async function patchProduct(seazonaProductId, body) {
    const res = await api.patch(`/admin/products/${encodeURIComponent(seazonaProductId)}`, body);
    return res.data.data.product;
  }

  async function handleSave(seazonaProductId, body) {
    setSaving(true);
    try {
      await patchProduct(seazonaProductId, body);
      setEditing(null);
      await load();
      setToast({ tone: "ok", text: "Product updated" });
    } catch (err) {
      setToast({ tone: "error", text: err.response?.data?.error?.message || "Update failed" });
    } finally {
      setSaving(false);
    }
  }

  async function handleTogglePurchasable(p) {
    try {
      await patchProduct(p.seazonaProductId, { purchasable: !p.purchasable });
      await load();
    } catch (err) {
      setToast({ tone: "error", text: err.response?.data?.error?.message || "Update failed" });
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await api.post("/admin/products/sync");
      const { inserted, updated, total } = res.data.data;
      await load();
      setToast({ tone: "ok", text: `Synced ${total} (${inserted} new, ${updated} updated)` });
    } catch (err) {
      setToast({ tone: "error", text: err.response?.data?.error?.message || "Sync failed" });
    } finally {
      setSyncing(false);
    }
  }

  const summary = data.summary;

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-end justify-between mb-6 flex-wrap gap-4">
        <div>
          <span className="font-mono text-xs text-navy/40 uppercase tracking-widest">Admin · Products</span>
          <h1 className="mt-2 font-heading font-bold text-3xl text-navy tracking-tight">Product Mirror</h1>
          <p className="mt-1 text-sm text-navy/50">
            A read-only mirror of Seazona products. Set which are shoppable and map each to a shop catalog SKU.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={load}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold text-navy/60 hover:text-navy hover:bg-surface-100 transition-all"
          >
            <RefreshCw size={12} /> Refresh
          </button>
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 transition-colors disabled:opacity-60"
          >
            {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {syncing ? "Syncing…" : "Sync from Seazona"}
          </button>
        </div>
      </div>

      {/* Helper banner */}
      <div className="rounded-2xl bg-amber-500/5 border border-amber-500/20 p-4 mb-6 flex gap-3">
        <Info size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-navy/70 leading-relaxed">
          Products are sourced from Seazona — this table is a one-way read-only mirror.{" "}
          <strong className="text-navy">A product must exist in Seazona to be orderable.</strong>{" "}
          New products created only here cannot be pushed as orders; create them in Seazona first,
          then run a sync. Shop-presentation fields (shoppable, catalog SKU, image, description,
          category) are local and are preserved across syncs.
        </p>
      </div>

      {/* Stats */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Stat label="Total products" value={summary.total.toLocaleString()} />
          <Stat label="Shoppable" value={summary.purchasable.toLocaleString()} tint="text-emerald-600" />
          <Stat label="Mapped to SKU" value={summary.mapped.toLocaleString()} />
          <Stat label="Needs linking" value={summary.needsLinking.toLocaleString()} tint={summary.needsLinking ? "text-amber-600" : "text-navy"} />
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col md:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-navy/30" />
          <input
            type="text"
            className={`${INPUT} pl-10`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, code, category, or catalog SKU…"
          />
        </div>
        <button
          type="button"
          onClick={() => setPurchasableOnly((v) => !v)}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
            purchasableOnly ? "bg-navy text-white" : "bg-surface-100 text-navy/60 hover:text-navy"
          }`}
        >
          {purchasableOnly ? <Eye size={14} /> : <EyeOff size={14} />}
          {purchasableOnly ? "Shoppable only" : "Showing all"}
        </button>
      </div>

      {/* Body */}
      {loading ? (
        <div className="py-20 flex items-center justify-center text-navy/40">
          <Loader2 size={18} className="animate-spin mr-2" /> Loading products…
        </div>
      ) : error ? (
        <div className="py-20 text-center">
          <AlertCircle size={32} className="mx-auto mb-3 text-red-500/40" />
          <p className="text-sm text-navy/60 max-w-md mx-auto">{error}</p>
          <button type="button" onClick={load} className="mt-4 px-4 py-2 rounded-full text-sm font-semibold bg-brand-500 text-white">
            Retry
          </button>
        </div>
      ) : data.products.length === 0 ? (
        <div className="py-20 text-center">
          <Package size={32} className="mx-auto mb-3 text-navy/20" />
          <p className="text-sm text-navy/50 max-w-md mx-auto">
            The product mirror is empty. Run a sync to pull the catalog from Seazona.
          </p>
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-60"
          >
            {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Sync from Seazona
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-surface-300/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-100 border-b border-surface-300/50">
                  <Th>Product</Th>
                  <Th>Code</Th>
                  <Th>Price</Th>
                  <Th>Taxable</Th>
                  <Th>Shoppable</Th>
                  <Th>Catalog SKU</Th>
                  <Th>Category</Th>
                  <Th>Last Synced</Th>
                  <Th className="text-right pr-4">Edit</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-16 text-navy/40">
                      No products match.
                    </td>
                  </tr>
                ) : (
                  filtered.map((p) => (
                    <Row
                      key={p.seazonaProductId}
                      product={p}
                      onEdit={() => setEditing(p)}
                      onTogglePurchasable={() => handleTogglePurchasable(p)}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && (
        <ProductEditor
          product={editing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
          saving={saving}
        />
      )}

      {toast && (
        <Toast tone={toast.tone} onDismiss={() => setToast(null)}>
          {toast.text}
        </Toast>
      )}
    </div>
  );
}

function Row({ product, onEdit, onTogglePurchasable }) {
  // Flag products that still need an admin's attention: shoppable but unmapped,
  // or mapped but not yet flagged shoppable.
  const unmappedShoppable = product.purchasable && !product.catalogId;
  const mappedNotShoppable = !product.purchasable && product.catalogId;
  const catalogName = product.catalogId ? CATALOG_NAME_BY_ID[product.catalogId] : null;

  return (
    <tr className="border-b border-surface-300/30 hover:bg-surface-50 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 flex-shrink-0 rounded-lg bg-surface-100 border border-surface-300/30 overflow-hidden">
            {product.imageUrl ? (
              <img
                src={product.imageUrl}
                alt=""
                className="w-full h-full object-contain p-0.5"
                onError={(e) => (e.target.style.display = "none")}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-navy/20">
                <Package size={14} />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-navy truncate max-w-[260px]">{product.name || "—"}</div>
            <div className="text-[10px] font-mono text-navy/30 truncate max-w-[260px]">{product.seazonaProductId}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 font-mono text-xs text-navy/60">{product.code || "—"}</td>
      <td className="px-4 py-3 text-sm font-semibold text-navy">{formatPrice(product.price)}</td>
      <td className="px-4 py-3 text-xs text-navy/60">{product.taxable ? "Yes" : "No"}</td>
      <td className="px-4 py-3">
        <button
          type="button"
          onClick={onTogglePurchasable}
          className={`w-9 h-5 rounded-full transition-colors relative ${product.purchasable ? "bg-emerald-500" : "bg-navy/20"}`}
          aria-label={product.purchasable ? "Set not shoppable" : "Set shoppable"}
        >
          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${product.purchasable ? "left-[18px]" : "left-0.5"}`} />
        </button>
      </td>
      <td className="px-4 py-3">
        {product.catalogId ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-navy/70">
            <Link2 size={12} className="text-emerald-600" />
            <span className="font-mono">{product.catalogId}</span>
            {catalogName && <span className="text-navy/40 truncate max-w-[120px]">· {catalogName}</span>}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs text-navy/30">
            <Link2Off size={12} /> Not mapped
          </span>
        )}
        {(unmappedShoppable || mappedNotShoppable) && (
          <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600">
            <AlertTriangle size={10} />
            {unmappedShoppable ? "Shoppable but no SKU" : "Mapped but not shoppable"}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-navy/60">{product.category || "—"}</td>
      <td className="px-4 py-3 text-xs text-navy/50">{formatDate(product.lastSyncedAt)}</td>
      <td className="px-4 py-3 text-right pr-4">
        <button
          type="button"
          onClick={onEdit}
          className="w-8 h-8 rounded-full hover:bg-surface-200 flex items-center justify-center text-navy/60 hover:text-navy transition-colors"
          aria-label="Edit"
        >
          <Edit3 size={14} />
        </button>
      </td>
    </tr>
  );
}
