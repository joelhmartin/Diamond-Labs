import { Link, useLocation } from "react-router-dom";
import { ROUTES } from "../../config/routes.js";
import { PageHero } from "../../components/marketing/PageHero";

export function ComingSoonPage() {
  const location = useLocation();

  // Derive a readable title from the URL path
  const pathTitle = location.pathname
    .split("/")
    .pop()
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div>
      <PageHero
        title={pathTitle}
        titleAccent="is coming soon."
        intro="We're putting the finishing touches on this page. Check back soon or contact us for more information."
        product="/images/ddso-isometric.webp"
        productAlt="A DDSO sleep appliance on a blue printed dental model"
      >
        <Link
          to="/contact"
          className="btn-magnetic group px-8 py-4 rounded-full bg-accent-500 text-white font-semibold"
        >
          <span className="btn-bg bg-accent-600 rounded-full" />
          <span className="relative z-10">Contact the lab</span>
        </Link>
        <Link
          to={ROUTES.REGISTER_DOCTOR}
          className="px-8 py-4 rounded-full border border-white/30 text-on-dark/90 font-medium hover:bg-white/10 transition-colors"
        >
          Apply for a doctor account
        </Link>
        <Link
          to="/"
          className="px-8 py-4 rounded-full border border-white/30 text-on-dark/90 font-medium hover:bg-white/10 transition-colors"
        >
          Home
        </Link>
      </PageHero>
    </div>
  );
}
