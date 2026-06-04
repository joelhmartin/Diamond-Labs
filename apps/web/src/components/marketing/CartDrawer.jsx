import { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  X,
  Plus,
  Minus,
  Trash2,
  ShoppingBag,
  ArrowRight,
  Image as ImageIcon,
} from "lucide-react";
import { useCartStore } from "../../stores/cart.store";

function formatUSD(n) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function LineItem({ item }) {
  const setQty = useCartStore((s) => s.setQty);
  const remove = useCartStore((s) => s.remove);

  return (
    <div className="flex gap-4 py-5 border-b border-surface-300/50">
      {/* Thumbnail */}
      <div className="flex-shrink-0 w-16 h-16 rounded-xl bg-surface-100 border border-surface-300/50 overflow-hidden">
        {item.image ? (
          <img
            src={item.image}
            alt={item.name}
            className="w-full h-full object-contain p-1"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-ink/20">
            <ImageIcon size={18} />
          </div>
        )}
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <h4 className="font-heading font-semibold text-sm text-ink tracking-tight leading-snug line-clamp-2">
            {item.name}
          </h4>
          <button
            type="button"
            onClick={() => remove(item.id)}
            className="text-ink/30 hover:text-accent-500 transition-colors flex-shrink-0"
            aria-label="Remove"
          >
            <Trash2 size={14} />
          </button>
        </div>
        <div className="mt-1 text-xs text-ink/45">
          {item.price === 0 ? "Included" : formatUSD(item.price)} each
        </div>

        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-1 bg-surface-100 rounded-full p-0.5">
            <button
              type="button"
              onClick={() => setQty(item.id, item.qty - 1)}
              className="w-7 h-7 rounded-full bg-white border border-surface-300/50 flex items-center justify-center text-ink/60 hover:text-ink transition-colors"
              aria-label="Decrease"
            >
              <Minus size={12} />
            </button>
            <span className="font-mono text-sm w-7 text-center">{item.qty}</span>
            <button
              type="button"
              onClick={() => setQty(item.id, item.qty + 1)}
              className="w-7 h-7 rounded-full bg-white border border-surface-300/50 flex items-center justify-center text-ink/60 hover:text-ink transition-colors"
              aria-label="Increase"
            >
              <Plus size={12} />
            </button>
          </div>
          <div className="font-heading font-bold text-sm tracking-tight">
            {item.price === 0 ? "Included" : formatUSD(item.qty * item.price)}
          </div>
        </div>
      </div>
    </div>
  );
}

export function CartDrawer() {
  const isOpen = useCartStore((s) => s.isOpen);
  const close = useCartStore((s) => s.close);
  const items = useCartStore((s) => s.items);
  const subtotal = useCartStore((s) => s.subtotal());
  const count = useCartStore((s) => s.count());
  const clear = useCartStore((s) => s.clear);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") close();
    }
    if (isOpen) {
      window.addEventListener("keydown", onKey);
      document.body.style.overflow = "hidden";
    }
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [isOpen, close]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-diamond-300/50 backdrop-blur-sm"
        onClick={close}
      />

      {/* Drawer */}
      <aside className="absolute top-0 right-0 h-full w-full max-w-md bg-white shadow-2xl flex flex-col animate-[slideIn_0.3s_ease-out]">
        {/* Header */}
        <div className="p-6 border-b border-surface-300/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShoppingBag size={18} className="text-brand-500" />
            <div>
              <h3 className="font-heading font-bold text-lg tracking-tight">
                Your Cart
              </h3>
              <div className="text-xs font-mono text-ink/40 uppercase tracking-wider">
                {count} {count === 1 ? "item" : "items"}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            className="w-9 h-9 rounded-full bg-surface-100 hover:bg-surface-200 flex items-center justify-center text-ink/60 hover:text-ink transition-colors"
            aria-label="Close cart"
          >
            <X size={16} />
          </button>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-6">
          {items.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-16 text-ink/40">
              <ShoppingBag size={32} className="mb-4 opacity-40" />
              <div className="font-heading font-semibold text-sm mb-1 text-ink/60">
                Your cart is empty
              </div>
              <div className="text-xs">
                Browse the catalog to add accessories or supplies.
              </div>
            </div>
          ) : (
            items.map((i) => <LineItem key={i.id} item={i} />)
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="p-6 border-t border-surface-300/50 bg-surface-100">
            <div className="flex items-center justify-between mb-5">
              <span className="font-mono text-xs text-ink/40 uppercase tracking-widest">
                Subtotal
              </span>
              <span className="font-heading font-bold text-2xl tracking-tight">
                {formatUSD(subtotal)}
              </span>
            </div>

            <Link
              to="/checkout"
              onClick={close}
              className="btn-magnetic group w-full px-6 py-3.5 rounded-full bg-accent-500 text-white font-semibold text-sm inline-flex justify-center"
            >
              <span className="btn-bg bg-accent-600 rounded-full" />
              <span className="relative z-10 flex items-center gap-2">
                Checkout
                <ArrowRight
                  size={14}
                  className="group-hover:translate-x-1 transition-transform"
                />
              </span>
            </Link>

            <button
              type="button"
              onClick={clear}
              className="mt-3 w-full text-xs font-mono text-ink/40 hover:text-accent-500 uppercase tracking-widest transition-colors py-2"
            >
              Clear Cart
            </button>

            <p className="mt-4 text-[11px] text-ink/40 text-center leading-relaxed">
              Accessories &amp; supplies only. Orthotics require a Digital Rx
              submission.
            </p>
          </div>
        )}
      </aside>

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
