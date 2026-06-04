import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ShoppingBag } from "lucide-react";
import { useCartStore } from "../../stores/cart.store";
import { CartDrawer } from "./CartDrawer";

export function CartWidget() {
  const count = useCartStore((s) => s.count());
  const toggle = useCartStore((s) => s.toggle);
  const badgeRef = useRef(null);
  const prevCount = useRef(count);

  // Pulse the badge when count increases
  useEffect(() => {
    if (count > prevCount.current && badgeRef.current) {
      gsap.fromTo(
        badgeRef.current,
        { scale: 0.7 },
        { scale: 1, duration: 0.4, ease: "back.out(2.2)" }
      );
    }
    prevCount.current = count;
  }, [count]);

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        className="fixed bottom-6 right-6 z-[9997] w-14 h-14 rounded-full bg-navy text-white shadow-xl shadow-navy/30 hover:bg-brand-500 hover:scale-[1.04] active:scale-[0.97] transition-all duration-300 flex items-center justify-center group"
        aria-label={`Open cart (${count} items)`}
      >
        <ShoppingBag
          size={20}
          className="group-hover:-rotate-6 transition-transform"
        />
        {count > 0 && (
          <span
            ref={badgeRef}
            className="absolute -top-1 -right-1 min-w-[22px] h-[22px] px-1.5 rounded-full bg-accent-500 text-white text-[11px] font-bold flex items-center justify-center border-2 border-white"
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      <CartDrawer />
    </>
  );
}
