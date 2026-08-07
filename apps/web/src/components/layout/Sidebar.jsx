import { NavLink, Link } from "react-router-dom";
import { clsx } from "clsx";
import {
  LayoutDashboard,
  Users,
  Settings,
  Package,
  FileText,
  ClipboardList,
  UserCog,
  FlaskConical,
  ClipboardPlus,
  CreditCard,
  Repeat,
  ArrowLeft,
} from "lucide-react";
import { brand } from "../../config/brand.js";
import { ROUTES } from "../../config/routes.js";
import { usePermission } from "../../hooks/usePermission.js";
import { useAuth } from "../../hooks/useAuth.js";

const mainItems = [
  { label: "Dashboard", to: ROUTES.DASHBOARD,   icon: LayoutDashboard, permission: null },
  { label: "Rx Forms",  to: ROUTES.RX_CHOOSER,  icon: ClipboardPlus,   permission: null },
  { label: "Members",   to: ROUTES.MEMBERS,     icon: Users,           permission: "users:read" },
  { label: "Settings",  to: ROUTES.SETTINGS,    icon: Settings,        permission: "settings:read" },
];

const adminItems = [
  { label: "Invoices",   to: ROUTES.ADMIN_INVOICES,    icon: FileText },
  { label: "Payments",   to: ROUTES.ADMIN_PAYMENTS,    icon: CreditCard },
  { label: "AutoPay",    to: ROUTES.ADMIN_AUTOPAY,     icon: Repeat },
  { label: "Orders",     to: ROUTES.ADMIN_ORDERS,      icon: ClipboardList },
  { label: "Users",      to: ROUTES.ADMIN_USERS,       icon: UserCog },
  { label: "Products",   to: ROUTES.ADMIN_PRODUCTS,    icon: Package },
  { label: "Rx Mapping", to: ROUTES.ADMIN_RX_MAPPING,  icon: FlaskConical },
];

function NavItem({ to, icon: Icon, label }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        clsx(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          isActive
            ? "bg-brand-50 text-brand-700"
            : "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
        )
      }
    >
      <Icon size={16} />
      {label}
    </NavLink>
  );
}

export function Sidebar() {
  const { can } = usePermission();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-gray-200 bg-white">
      <div className="flex h-16 items-center px-6">
        <Link
          to="/"
          className="text-lg font-bold text-gray-900 transition-colors hover:text-brand-700"
        >
          {brand.name}
        </Link>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {mainItems.map((item) => {
          if (item.permission && !can(item.permission)) return null;
          return <NavItem key={item.to} {...item} />;
        })}

        {isAdmin && (
          <>
            <div className="px-3 pt-6 pb-2 text-[10px] font-mono uppercase tracking-widest text-gray-400">
              Admin
            </div>
            {adminItems.map((item) => (
              <NavItem key={item.to} {...item} />
            ))}
          </>
        )}
      </nav>

      <div className="border-t border-gray-200 px-3 py-4">
        <Link
          to="/"
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
        >
          <ArrowLeft size={16} />
          Back to site
        </Link>
      </div>
    </aside>
  );
}
