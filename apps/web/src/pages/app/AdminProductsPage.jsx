import { useMemo, useState } from "react";
import {
  Plus,
  Search,
  Edit3,
  Trash2,
  X,
  Save,
  Image as ImageIcon,
  Check,
  RefreshCw,
  Package,
  Eye,
  EyeOff,
} from "lucide-react";
import { useCatalogStore } from "../../stores/catalog.store";
import {
  AVAILABILITY_STATES,
  AVAILABILITY_META,
  blankProduct,
} from "../../data/catalog";

const INPUT =
  "w-full px-3.5 py-2.5 rounded-lg bg-white border border-surface-300/60 text-ink text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all placeholder:text-ink/25";

function formatPrice(p) {
  if (p === 0) return "Included";
  return `$${Number(p).toFixed(2)}`;
}

/* ─── EDIT MODAL ─── */
function ProductEditor({ product, onClose, onSave }) {
  const [draft, setDraft] = useState(product);

  const update = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const updateCats = (str) =>
    update(
      "categories",
      str.split(",").map((s) => s.trim()).filter(Boolean)
    );

  function save() {
    const cleaned = {
      ...draft,
      price: Number(draft.price) || 0,
      stock: Number(draft.stock) || 0,
    };
    // Sync `images` with `image`
    cleaned.images = cleaned.image ? [cleaned.image] : [];
    onSave(cleaned);
  }

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-end md:items-center justify-center p-0 md:p-6 bg-diamond-300/50 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl bg-white md:rounded-[2rem] rounded-t-[2rem] p-6 md:p-8 shadow-2xl max-h-[95dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="font-heading font-bold text-xl text-ink">
              {product.__isNew ? "Add product" : "Edit product"}
            </h2>
            <p className="text-xs text-ink/40 mt-0.5 font-mono">#{draft.id}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-surface-100 hover:bg-surface-200 flex items-center justify-center text-ink/60"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Image preview + paths */}
          <div className="md:col-span-1 space-y-3">
            <div className="aspect-square rounded-2xl overflow-hidden bg-surface-100 border border-surface-300/50">
              {draft.image ? (
                <img
                  src={draft.image}
                  alt=""
                  className="w-full h-full object-contain p-4"
                  onError={(e) => (e.target.style.display = "none")}
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-ink/20">
                  <ImageIcon size={32} />
                  <span className="mt-2 text-[10px] font-mono">No image</span>
                </div>
              )}
            </div>
            <div>
              <label className="block text-[10px] font-mono text-ink/40 uppercase tracking-widest mb-1.5">
                Image URL (/catalog/… or full URL)
              </label>
              <input
                className={INPUT}
                value={draft.image || ""}
                onChange={(e) => update("image", e.target.value || null)}
                placeholder="/catalog/product.webp"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono text-ink/40 uppercase tracking-widest mb-1.5">
                Thumbnail URL
              </label>
              <input
                className={INPUT}
                value={draft.thumbnail || ""}
                onChange={(e) => update("thumbnail", e.target.value || null)}
                placeholder="/catalog/thumbnails/..."
              />
            </div>
          </div>

          {/* Fields */}
          <div className="md:col-span-2 space-y-4">
            <div>
              <label className="block text-[10px] font-mono text-ink/40 uppercase tracking-widest mb-1.5">
                Name
              </label>
              <input
                className={INPUT}
                value={draft.name}
                onChange={(e) => update("name", e.target.value)}
              />
            </div>

            <div>
              <label className="block text-[10px] font-mono text-ink/40 uppercase tracking-widest mb-1.5">
                Description
              </label>
              <textarea
                rows={2}
                className={`${INPUT} resize-none`}
                value={draft.description}
                onChange={(e) => update("description", e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-mono text-ink/40 uppercase tracking-widest mb-1.5">
                  Price ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  className={INPUT}
                  value={draft.price}
                  onChange={(e) => update("price", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono text-ink/40 uppercase tracking-widest mb-1.5">
                  Stock
                </label>
                <input
                  type="number"
                  className={INPUT}
                  value={draft.stock}
                  onChange={(e) => update("stock", e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-mono text-ink/40 uppercase tracking-widest mb-1.5">
                Categories (comma-separated)
              </label>
              <input
                className={INPUT}
                value={draft.categories.join(", ")}
                onChange={(e) => updateCats(e.target.value)}
                placeholder="Tools, Mouth Guards"
              />
            </div>

            <div>
              <label className="block text-[10px] font-mono text-ink/40 uppercase tracking-widest mb-1.5">
                Availability
              </label>
              <div className="flex flex-wrap gap-1.5">
                {AVAILABILITY_STATES.map((s) => {
                  const meta = AVAILABILITY_META[s];
                  const active = draft.availability === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => update("availability", s)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                        active
                          ? "bg-diamond-300 text-ink"
                          : `${meta.color} hover:bg-diamond-300/10`
                      }`}
                    >
                      {meta.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => update("active", !draft.active)}
                className={`flex items-center gap-3 w-full p-3 rounded-xl border transition-all ${
                  draft.active
                    ? "bg-emerald-500/5 border-emerald-500/30"
                    : "bg-diamond-300/5 border-ink/20"
                }`}
              >
                <div
                  className={`w-10 h-6 rounded-full transition-colors relative ${
                    draft.active ? "bg-emerald-500" : "bg-diamond-300/30"
                  }`}
                >
                  <div
                    className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
                      draft.active ? "left-[18px]" : "left-0.5"
                    }`}
                  />
                </div>
                <div className="flex-1 text-left">
                  <div className="text-sm font-semibold text-ink">
                    {draft.active ? "Active — visible to shoppers" : "Inactive — hidden from catalog"}
                  </div>
                  <div className="text-xs text-ink/40">
                    Inactive items stay in the admin but don&apos;t render publicly.
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>

        <div className="mt-8 flex items-center justify-end gap-2 pt-5 border-t border-surface-300/30">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-full text-sm font-medium text-ink/60 hover:bg-surface-100 transition-all"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            className="flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 transition-colors"
          >
            <Save size={14} />
            {product.__isNew ? "Add product" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── MAIN PAGE ─── */
export function AdminProductsPage() {
  const products = useCatalogStore((s) => s.products);
  const upsert = useCatalogStore((s) => s.upsert);
  const remove = useCatalogStore((s) => s.remove);
  const toggleActive = useCatalogStore((s) => s.toggleActive);
  const resetToSeed = useCatalogStore((s) => s.resetToSeed);

  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(true);
  const [editing, setEditing] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (!showInactive && !p.active) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.id.toString().includes(q) ||
        p.categories.join(" ").toLowerCase().includes(q)
      );
    });
  }, [products, query, showInactive]);

  const stats = useMemo(() => {
    const total = products.length;
    const active = products.filter((p) => p.active).length;
    const inStock = products.filter(
      (p) => p.availability === "in-stock"
    ).length;
    const outOfStock = products.filter(
      (p) => p.availability === "out-of-stock"
    ).length;
    return { total, active, inStock, outOfStock };
  }, [products]);

  function handleSave(product) {
    const { __isNew, ...clean } = product;
    upsert(clean);
    setEditing(null);
  }

  function handleDelete(p) {
    if (window.confirm(`Delete "${p.name}"? This is permanent.`)) {
      remove(p.id);
    }
  }

  function handleAdd() {
    setEditing({ ...blankProduct(), __isNew: true });
  }

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
        <div>
          <span className="font-mono text-xs text-ink/40 uppercase tracking-widest">
            Admin · Catalog
          </span>
          <h1 className="mt-2 font-heading font-bold text-3xl text-ink tracking-tight">
            Product Management
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold text-ink/50 hover:text-ink hover:bg-surface-100 transition-all"
          >
            <RefreshCw size={12} />
            Reset to seed
          </button>
          <button
            type="button"
            onClick={handleAdd}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 transition-colors"
          >
            <Plus size={14} />
            Add product
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Total" value={stats.total} />
        <Stat label="Active" value={stats.active} tint="text-emerald-600" />
        <Stat label="In Stock" value={stats.inStock} />
        <Stat label="Out of Stock" value={stats.outOfStock} tint="text-red-600" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-col md:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-ink/30"
          />
          <input
            type="text"
            className={`${INPUT} pl-10`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, id, category…"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowInactive((v) => !v)}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
            showInactive
              ? "bg-diamond-300 text-ink"
              : "bg-surface-100 text-ink/60 hover:text-ink"
          }`}
        >
          {showInactive ? <Eye size={14} /> : <EyeOff size={14} />}
          {showInactive ? "Showing inactive" : "Active only"}
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-surface-300/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-100 border-b border-surface-300/50">
                <Th>#</Th>
                <Th>Product</Th>
                <Th>Category</Th>
                <Th>Price</Th>
                <Th>Stock</Th>
                <Th>Availability</Th>
                <Th>Active</Th>
                <Th className="text-right pr-4">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-16 text-ink/40">
                    No products match.
                  </td>
                </tr>
              ) : (
                filtered.map((p) => (
                  <Row
                    key={p.id}
                    product={p}
                    onEdit={() => setEditing(p)}
                    onDelete={() => handleDelete(p)}
                    onToggleActive={() => toggleActive(p.id)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-4 text-xs text-ink/40 text-center">
        Catalog changes persist to localStorage. When a backend is wired,
        these actions will call the API instead.
      </p>

      {editing && (
        <ProductEditor
          product={editing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}

      {confirmReset && (
        <div
          className="fixed inset-0 z-[9998] flex items-center justify-center p-6 bg-diamond-300/50 backdrop-blur-sm"
          onClick={() => setConfirmReset(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 max-w-sm shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-heading font-bold text-lg text-ink">
              Reset catalog to seed?
            </h3>
            <p className="mt-2 text-sm text-ink/60 leading-relaxed">
              This will discard every admin edit and added product, restoring
              the 54-item seed catalog. Cannot be undone.
            </p>
            <div className="mt-5 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="px-4 py-2 rounded-full text-sm text-ink/60 hover:bg-surface-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  resetToSeed();
                  setConfirmReset(false);
                }}
                className="px-4 py-2 rounded-full text-sm font-semibold bg-red-500 text-ink hover:bg-red-600"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tint = "text-ink" }) {
  return (
    <div className="bg-white rounded-2xl border border-surface-300/50 p-4">
      <div className={`font-heading font-bold text-2xl tracking-tight ${tint}`}>
        {value}
      </div>
      <div className="text-[10px] font-mono text-ink/40 uppercase tracking-widest mt-0.5">
        {label}
      </div>
    </div>
  );
}

function Th({ children, className = "" }) {
  return (
    <th
      className={`text-left px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-ink/40 font-normal ${className}`}
    >
      {children}
    </th>
  );
}

function Row({ product, onEdit, onDelete, onToggleActive }) {
  const avail = AVAILABILITY_META[product.availability] || AVAILABILITY_META["in-stock"];
  return (
    <tr
      className={`border-b border-surface-300/30 hover:bg-surface-50 transition-colors ${
        !product.active ? "opacity-60" : ""
      }`}
    >
      <td className="px-4 py-3 font-mono text-xs text-ink/40">{product.id}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 flex-shrink-0 rounded-lg bg-surface-100 border border-surface-300/30 overflow-hidden">
            {product.thumbnail || product.image ? (
              <img
                src={product.thumbnail || product.image}
                alt=""
                className="w-full h-full object-contain p-0.5"
                onError={(e) => (e.target.style.display = "none")}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-ink/20">
                <Package size={14} />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-ink truncate max-w-[280px]">
              {product.name}
            </div>
            {product.description && (
              <div className="text-xs text-ink/40 truncate max-w-[280px]">
                {product.description}
              </div>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-xs text-ink/60">
        {product.categories.join(", ") || "—"}
      </td>
      <td className="px-4 py-3 text-sm font-semibold text-ink">
        {formatPrice(product.price)}
      </td>
      <td className="px-4 py-3 text-sm text-ink/60 font-mono tabular-nums">
        {product.stock.toLocaleString()}
      </td>
      <td className="px-4 py-3">
        <span
          className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${avail.color}`}
        >
          {avail.label}
        </span>
      </td>
      <td className="px-4 py-3">
        <button
          type="button"
          onClick={onToggleActive}
          className={`w-9 h-5 rounded-full transition-colors relative ${
            product.active ? "bg-emerald-500" : "bg-diamond-300/20"
          }`}
          aria-label={product.active ? "Set inactive" : "Set active"}
        >
          <div
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
              product.active ? "left-[18px]" : "left-0.5"
            }`}
          />
        </button>
      </td>
      <td className="px-4 py-3 text-right pr-4">
        <div className="flex justify-end gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="w-8 h-8 rounded-full hover:bg-surface-200 flex items-center justify-center text-ink/60 hover:text-ink transition-colors"
            aria-label="Edit"
          >
            <Edit3 size={14} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="w-8 h-8 rounded-full hover:bg-red-50 flex items-center justify-center text-ink/50 hover:text-red-500 transition-colors"
            aria-label="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
}
