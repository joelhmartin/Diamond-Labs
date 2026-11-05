import { useEffect, useMemo, useState } from "react";
import { LAB_LINE_QTY_MAX } from "@my-app/shared";
import api from "../../../config/api.js";
import { errorText } from "../../../lib/requests.js";
import { INPUT } from "../form-styles.js";

/**
 * Picks a catalog variant: a product family first, then one of its variants, with a
 * quantity. Calls `onAdd({ variantId, code, name, qty })`. Prices are not shown here; the
 * caller prices the chosen lines for the practice through /lab/orders/price-preview.
 */
export function LinePicker({ onAdd, disabled = false }) {
  const [families, setFamilies] = useState(null);
  const [error, setError] = useState("");
  const [familyId, setFamilyId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [qty, setQty] = useState(1);

  useEffect(() => {
    let live = true;
    api.get("/admin/catalog/families")
      .then((res) => { if (live) setFamilies(res.data.data.families.filter((f) => f.active !== false)); })
      .catch((err) => { if (live) { setFamilies([]); setError(errorText(err)); } });
    return () => { live = false; };
  }, []);

  const family = useMemo(() => (families ?? []).find((f) => f.id === familyId), [families, familyId]);
  const variants = useMemo(() => (family?.variants ?? []).filter((v) => v.active !== false), [family]);
  const variant = variants.find((v) => v.id === variantId);

  const pickFamily = (id) => {
    setFamilyId(id);
    const only = ((families ?? []).find((f) => f.id === id)?.variants ?? []).filter((v) => v.active !== false);
    setVariantId(only.length === 1 ? only[0].id : "");
  };

  const add = () => {
    if (!variant) return;
    onAdd({ variantId: variant.id, code: variant.code ?? null, name: variant.name, qty });
    setQty(1);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <select aria-label="Product family" className={`${INPUT} sm:w-56`} disabled={disabled || families === null} value={familyId} onChange={(e) => pickFamily(e.target.value)}>
          <option value="">{families === null ? "Loading catalog…" : "Product family"}</option>
          {(families ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <select aria-label="Product variant" className={`${INPUT} sm:w-64`} disabled={disabled || !family} value={variantId} onChange={(e) => setVariantId(e.target.value)}>
          <option value="">Variant</option>
          {variants.map((v) => <option key={v.id} value={v.id}>{v.code ? `${v.code} · ` : ""}{v.name}</option>)}
        </select>
        <input
          type="number"
          aria-label="Quantity"
          className={`${INPUT} w-20`}
          min={1}
          max={LAB_LINE_QTY_MAX}
          disabled={disabled}
          value={qty}
          onChange={(e) => setQty(Math.min(LAB_LINE_QTY_MAX, Math.max(1, Math.trunc(Number(e.target.value)) || 1)))}
        />
        <button type="button" disabled={disabled || !variant} onClick={add} className="rounded-full bg-navy px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">
          Add line
        </button>
      </div>
      {error && <p role="alert" className="text-xs text-red-600">Couldn't load the catalog: {error}</p>}
    </div>
  );
}
