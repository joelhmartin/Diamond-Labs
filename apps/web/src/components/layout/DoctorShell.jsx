import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { clsx } from "clsx";
import { ArrowLeft, FileText, CreditCard, ClipboardPlus, ClipboardList, Receipt, RefreshCw, MessageSquare, PackageOpen } from "lucide-react";
import { brand } from "../../config/brand.js";
import { ROUTES } from "../../config/routes.js";
import { useAuth } from "../../hooks/useAuth.js";
import { LAB_TIMEZONE } from "@my-app/shared";
import { NotificationBell } from "../../modules/notifications/index.js";
import { MessagesBadge } from "../../modules/messaging/index.js";
import { AccountSwitcher } from "../account/AccountSwitcher.jsx";

// "Rx Forms" is for doctors; a staff or owner login that only has practices reads and pays (no "New case").
const RX_NAV = { label: "Rx Forms", to: ROUTES.RX_CHOOSER, icon: ClipboardPlus };
const navItems = [
  { label: "Invoices", to: ROUTES.DOCTOR_INVOICES, icon: FileText },
  { label: "Payments", to: ROUTES.DOCTOR_PAYMENTS, icon: Receipt },
  { label: "My cases", to: ROUTES.DOCTOR_CASES, icon: ClipboardList },
  { label: "Messages", to: ROUTES.DOCTOR_MESSAGES, icon: MessageSquare, badge: <MessagesBadge /> },
  { label: "Pickups", to: ROUTES.DOCTOR_PICKUPS, icon: PackageOpen },
  { label: "Saved Cards", to: ROUTES.DOCTOR_SAVED_CARDS, icon: CreditCard },
  { label: "AutoPay", to: ROUTES.DOCTOR_AUTOPAY, icon: RefreshCw },
];

export function DoctorShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const items = user?.role === "doctor" ? [...navItems.slice(0, 5), RX_NAV, ...navItems.slice(5)] : navItems;

  const handleLogout = async () => {
    await logout();
    navigate(ROUTES.LOGIN);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-6">
        <div className="flex items-center gap-6">
          <Link
            to="/"
            className="text-lg font-bold text-gray-900 transition-colors hover:text-brand-700"
          >
            {brand.name}
          </Link>
          <nav className="flex items-center gap-1">
            {items.map(({ label, to, icon: Icon, badge }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  clsx(
                    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-brand-50 text-brand-700"
                      : "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
                  )
                }
              >
                <Icon size={16} />
                {label}
                {badge}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <AccountSwitcher variant="practice" />
          <NotificationBell to={ROUTES.DOCTOR_NOTIFICATIONS} timeZone={LAB_TIMEZONE} />
          <Link
            to="/"
            className="flex items-center gap-2 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900"
          >
            <ArrowLeft size={16} />
            Back to site
          </Link>
          {user?.name && (
            <span className="text-sm font-medium text-gray-700">{user.name}</span>
          )}
          <button
            onClick={handleLogout}
            className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
          >
            Log out
          </button>
        </div>
      </header>

      <main>
        <Outlet />
      </main>
    </div>
  );
}
