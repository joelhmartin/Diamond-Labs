import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { ProductViewer } from "./ProductViewer";
import { useCartStore } from "../../stores/cart.store";
import { AVAILABILITY_META } from "../../data/catalog";
import { variantFor, cartItemFor } from "../../lib/catalog.js";
import { formatCents } from "../../lib/money.js";

/**
 * Adapts a shop product (see lib/catalog.js familyToProduct) plus the
 * currently selected variant into the ProductViewer schema.
 */
function toViewerShape(p, variant) {
  const priceCents = variant ? variant.priceCents : p.priceFromCents;
  const price = priceCents === 0 ? "Included" : `${variant ? "" : "From "}${formatCents(priceCents)}`;
  const specs = [
    ...(variant?.code ? [{ label: "SKU", value: `#${variant.code}` }] : []),
    { label: "Price", value: price },
    { label: "Availability", value: AVAILABILITY_META[p.availability]?.label ?? "In Stock" },
    ...(p.categories.length ? [{ label: "Category", value: p.categories.join(" · ") }] : []),
  ];
  return {
    name: p.name,
    fullName: p.description || p.categories[0] || "Diamond Orthotic Catalog",
    tagline: p.description || "Contact the lab for questions on this item.",
    category: p.categories[0] || "Catalog",
    categoryColor: "text-navy/60",
    categoryBg: "bg-surface-200/80",
    images: [{ src: p.image, label: p.name }],
    specs,
  };
}

export function CatalogDetail({ product, onClose }) {
  const add = useCartStore((s) => s.add);
  const open = useCartStore((s) => s.open);
  const family = product?.family;
  const [picked, setPicked] = useState({});

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const variant = useMemo(
    () => (family ? variantFor(family, Object.values(picked)) : null),
    [family, picked],
  );

  if (!product) return null;
  const viewerProduct = toViewerShape(product, variant);
  const priceValue = viewerProduct.specs.find((s) => s.label === "Price").value;

  // A combination can exist in the option lists without a sellable variant
  // (the server hides unpriced ones), so only offer values that still lead somewhere.
  function reachable(optionId, valueId) {
    const others = Object.entries(picked).filter(([o]) => o !== optionId).map(([, v]) => v);
    return family.variants.some(
      (v) => v.optionValueIds.includes(valueId) && others.every((o) => v.optionValueIds.includes(o)),
    );
  }

  function handleAdd() {
    if (!variant) return;
    add(cartItemFor(family, variant));
    open();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-end md:items-center justify-center p-0 md:p-6 bg-navy/50 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-5xl bg-white md:card-radius-lg rounded-t-[2rem] md:rounded-[3rem] p-6 md:p-10 shadow-2xl max-h-[95dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 md:top-6 md:right-6 z-10 w-10 h-10 rounded-full bg-surface-100 hover:bg-surface-200 flex items-center justify-center text-navy/60 hover:text-navy transition-colors"
          aria-label="Close"
        >
          <X size={18} />
        </button>

        {family.options.length > 0 && (
          <div className="mb-6 space-y-4">
            {family.options.map((o) => (
              <div key={o.id}>
                <p className="font-mono text-xs text-navy/40 uppercase tracking-widest mb-2">{o.name}</p>
                <div className="flex flex-wrap gap-2">
                  {o.values.map((v) => {
                    const on = picked[o.id] === v.id;
                    const ok = reachable(o.id, v.id);
                    return (
                      <button
                        key={v.id}
                        type="button"
                        disabled={!ok}
                        onClick={() => setPicked((p) => ({ ...p, [o.id]: v.id }))}
                        className={`px-4 py-2 rounded-full text-sm border transition-all ${
                          on ? "bg-navy text-white border-navy" : "bg-white border-surface-300 text-navy hover:border-brand-500"
                        } ${ok ? "" : "opacity-30 cursor-not-allowed"}`}
                      >
                        {v.value}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <ProductViewer
          product={viewerProduct}
          onCta={handleAdd}
          ctaLabel={variant ? `Add to Cart · ${priceValue}` : "Choose options"}
          registered={false}
        />
      </div>
    </div>
  );
}
