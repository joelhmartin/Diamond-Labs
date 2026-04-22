import { useEffect } from "react";
import { Link } from "react-router-dom";
import { X, FileText } from "lucide-react";
import { ProductViewer } from "./ProductViewer";
import { useCartStore } from "../../stores/cart.store";

/**
 * Adapts a catalog product (simple shape) into the ProductViewer schema.
 */
function toViewerShape(p) {
  const price = p.price === 0 ? "Included" : `$${p.price.toFixed(2)}`;
  const stockValue =
    p.stock > 0 ? "In Stock" : p.stock === 0 ? "Out of Stock" : "Backorder";

  const specs = [
    { label: "SKU",        value: `#${p.id}` },
    { label: "Price",      value: price },
    { label: "Availability", value: stockValue },
    ...(p.categories.length
      ? [{ label: "Category", value: p.categories.join(" · ") }]
      : []),
  ];

  return {
    name: p.name,
    fullName: p.description || p.categories[0] || "Diamond Orthotic Catalog",
    tagline: p.description || "Contact the lab for questions on this item.",
    category: p.rxOnly ? "Rx Only" : p.categories[0] || "Catalog",
    categoryColor: p.rxOnly ? "text-brand-600" : "text-navy/60",
    categoryBg: p.rxOnly ? "bg-brand-500/10" : "bg-surface-200/80",
    images:
      p.images && p.images.length
        ? p.images.map((src) => ({ src, label: p.name }))
        : [{ src: null, label: p.name }],
    specs,
  };
}

export function CatalogDetail({ product, onClose }) {
  const add = useCartStore((s) => s.add);
  const open = useCartStore((s) => s.open);

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

  if (!product) return null;

  const viewerProduct = toViewerShape(product);
  const canAdd = !product.rxOnly;

  function handleAdd() {
    add(product);
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
        {/* Close */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 md:top-6 md:right-6 z-10 w-10 h-10 rounded-full bg-surface-100 hover:bg-surface-200 flex items-center justify-center text-navy/60 hover:text-navy transition-colors"
          aria-label="Close"
        >
          <X size={18} />
        </button>

        {canAdd ? (
          <ProductViewer
            product={viewerProduct}
            onCta={handleAdd}
            ctaLabel={`Add to Cart · ${viewerProduct.specs.find((s) => s.label === "Price").value}`}
            registered={false}
          />
        ) : (
          <>
            <ProductViewer
              product={viewerProduct}
              ctaTo="/submit-case"
              ctaLabel="Submit Digital Rx"
              registered={false}
            />
            <div className="mt-6 p-4 rounded-2xl bg-brand-500/5 border border-brand-500/20 flex gap-3 items-start">
              <FileText
                size={16}
                className="text-brand-500 flex-shrink-0 mt-0.5"
              />
              <div className="text-sm text-navy/70 leading-relaxed">
                This item is <span className="font-semibold">Rx-only</span> —
                it can&apos;t be ordered directly. Submit the Digital Rx form
                with case details and we&apos;ll fabricate + ship.{" "}
                <Link
                  to="/submit-case"
                  className="text-brand-500 font-semibold hover:underline"
                >
                  Go to Digital Rx →
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
