import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { glideTo } from "../../lib/scroll";
import { prefersReducedMotion } from "../../lib/reducedMotion";

const goToTop = () => {
  if (prefersReducedMotion()) window.scrollTo({ top: 0, behavior: "instant" });
  else glideTo(0);
};

/* A round button at the bottom left, the mirror of the cart button at the bottom right.
   It appears once the visitor has moved away from the top of the page. */
export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const update = () => setVisible(window.scrollY > window.innerHeight * 0.5);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <button
      type="button"
      aria-label="Back to top"
      tabIndex={visible ? 0 : -1}
      onClick={goToTop}
      className={`fixed bottom-6 left-6 z-[9997] w-14 h-14 rounded-full bg-navy text-white shadow-xl shadow-navy/30 hover:bg-brand-500 hover:scale-[1.03] transition-all duration-300 flex items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400 ${
        visible ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
    >
      <ArrowUp size={20} />
    </button>
  );
}
