import { useState } from "react";
import { Plus, Check, Image as ImageIcon } from "lucide-react";
import { useCartStore } from "../../stores/cart.store";

function formatPrice(p) {
  if (p === 0) return "Included";
  return `$${p.toFixed(2)}`;
}

export function CatalogCard({ product, onOpen }) {
  const add = useCartStore((s) => s.add);
  const [added, setAdded] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  const img = product.thumbnail || product.image;
  const showImage = img && !imgFailed;

  function handleAdd(e) {
    e.stopPropagation();
    add(product);
    setAdded(true);
    setTimeout(() => setAdded(false), 1400);
  }

  return (
    <div
      onClick={onOpen}
      className="group cursor-pointer bg-white card-radius border border-surface-300/50 hover:border-brand-500/30 hover:shadow-lg hover:shadow-navy/5 transition-all duration-500 flex flex-col overflow-hidden"
    >
      {/* Image */}
      <div className="relative aspect-square bg-surface-100 overflow-hidden">
        {showImage ? (
          <img
            src={img}
            alt={product.name}
            className="w-full h-full object-contain p-4 group-hover:scale-[1.03] transition-transform duration-700"
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-navy/20">
            <ImageIcon size={28} />
            <span className="mt-2 text-[10px] font-mono uppercase tracking-widest">
              Image pending
            </span>
          </div>
        )}

        {product.categories[0] && (
          <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-surface-100/90 text-navy/60 backdrop-blur-sm border border-surface-300/50">
            {product.categories[0]}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="p-4 md:p-5 flex flex-col flex-1">
        <h3 className="font-heading font-semibold text-sm md:text-base text-navy tracking-tight leading-snug line-clamp-2 min-h-[2.5rem]">
          {product.name}
        </h3>
        {product.description && (
          <p className="mt-1 text-xs text-navy/45 leading-snug line-clamp-2">
            {product.description}
          </p>
        )}

        <div className="mt-4 pt-4 border-t border-surface-300/50 flex items-center justify-between">
          <div className="font-heading font-bold text-lg tracking-tight">
            {formatPrice(product.price)}
          </div>

          {added ? (
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold bg-emerald-500 text-white">
              <Check size={13} />
              Added
            </div>
          ) : (
            <button
              type="button"
              onClick={handleAdd}
              className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold bg-navy text-white hover:bg-brand-500 transition-colors"
            >
              <Plus size={13} />
              Add
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
