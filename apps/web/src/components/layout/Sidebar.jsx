import { NavLink } from "react-router-dom";
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
} from "lucide-react";
import { brand } from "../../config/brand.js";
import { ROUTES } from "../../config/routes.js";
import { usePermission } from "../../hooks/usePermission.js";
import { useAuth } from "../../hooks/useAuth.js";

const mainItems = [
  { label: "Dashboard", to: ROUTES.DASHBOARD, icon: LayoutDashboard, permission: null },
  { label: "Members",   to: ROUTES.MEMBERS,   icon: Users,           permission: "users:read" },
  { label: "Settings",  to: ROUTES.SETTINGS,  icon: Settings,        permission: "settings:read" },
];

const adminItems = [
  { label: "Invoices",   to: ROUTES.ADMIN_INVOICES,    icon: FileText },
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
        <span className="text-lg font-bold text-gray-900">{brand.name}</span>
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
    </aside>
  );
}
