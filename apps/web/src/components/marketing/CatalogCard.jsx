import { useState } from "react";
import { Plus, Minus, Check, Image as ImageIcon } from "lucide-react";
import { useCartStore } from "../../stores/cart.store";
import { AVAILABILITY_META } from "../../data/catalog";

function formatPrice(p) {
  if (p === 0) return "Included";
  return `$${p.toFixed(2)}`;
}

export function CatalogCard({ product, onOpen }) {
  const add = useCartStore((s) => s.add);
  const setQty = useCartStore((s) => s.setQty);
  const cartItem = useCartStore((s) =>
    s.items.find((i) => i.id === product.id)
  );
  const [imgFailed, setImgFailed] = useState(false);

  const img = product.thumbnail || product.image;
  const showImage = img && !imgFailed;
  const inCart = Boolean(cartItem);
  const qty = cartItem?.qty ?? 0;

  const avail = AVAILABILITY_META[product.availability] || AVAILABILITY_META["in-stock"];
  const canBuy = avail.canBuy;
  const isLowStock = product.availability === "low-stock";

  function handleAdd(e) {
    e.stopPropagation();
    if (!canBuy) return;
    add(product);
  }

  function handleInc(e) {
    e.stopPropagation();
    if (!canBuy) return;
    setQty(product.id, qty + 1);
  }

  function handleDec(e) {
    e.stopPropagation();
    setQty(product.id, qty - 1);
  }

  return (
    <div
      onClick={onOpen}
      className={`group cursor-pointer card-radius transition-all duration-500 flex flex-col overflow-hidden ${
        inCart
          ? "bg-white border-2 border-brand-500 shadow-lg shadow-brand-500/10"
          : "bg-white border border-surface-300/50 hover:border-brand-500/30 hover:shadow-lg hover:shadow-navy/5"
      } ${!canBuy ? "opacity-80" : ""}`}
    >
      {/* Image */}
      <div className="relative aspect-square bg-surface-100 overflow-hidden">
        {showImage ? (
          <img
            src={img}
            alt={product.name}
            className={`w-full h-full object-contain p-4 transition-transform duration-700 ${
              canBuy ? "group-hover:scale-[1.03]" : "grayscale"
            }`}
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

        {/* Availability badge (always shown if non-default) */}
        {product.availability !== "in-stock" && (
          <span
            className={`absolute bottom-3 left-3 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${avail.color}`}
          >
            {isLowStock && product.stock > 0
              ? `Only ${product.stock} left`
              : avail.label}
          </span>
        )}

        {inCart && canBuy && (
          <span className="absolute top-3 right-3 flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-brand-500 text-white shadow-md shadow-brand-500/20">
            <Check size={10} strokeWidth={3} />
            In Cart
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

          {!canBuy ? (
            <div
              className={`px-3 py-2 rounded-full text-xs font-semibold ${avail.color}`}
              onClick={(e) => e.stopPropagation()}
            >
              {avail.label}
            </div>
          ) : inCart ? (
            <div
              className="flex items-center gap-0.5 bg-brand-500 rounded-full p-0.5"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={handleDec}
                className="w-7 h-7 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-white transition-colors"
                aria-label="Decrease quantity"
              >
                <Minus size={12} strokeWidth={2.5} />
              </button>
              <span className="font-mono text-sm font-bold text-white w-7 text-center tabular-nums">
                {qty}
              </span>
              <button
                type="button"
                onClick={handleInc}
                className="w-7 h-7 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-white transition-colors"
                aria-label="Increase quantity"
              >
                <Plus size={12} strokeWidth={2.5} />
              </button>
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
