import { Outlet, NavLink } from "react-router-dom";
import { Package, FileText, Users, LayoutDashboard } from "lucide-react";

const TABS = [
  { to: "/admin/products", label: "Products",  Icon: Package },
  { to: "/admin/invoices", label: "Invoices",  Icon: FileText },
  // Placeholders for future admin sections — uncomment when built.
  // { to: "/admin/users",    label: "Users",     Icon: Users },
];

export function AdminLayout() {
  return (
    <div>
      <div className="border-b border-surface-300/60 bg-white">
        <div className="max-w-7xl mx-auto px-6 md:px-8 pt-6 pb-0">
          <div className="flex items-center gap-3 mb-4">
            <LayoutDashboard size={14} className="text-navy/40" />
            <span className="font-mono text-xs text-navy/40 uppercase tracking-widest">
              Admin
            </span>
          </div>
          <nav className="flex items-center gap-1 -mb-px overflow-x-auto scrollbar-hide">
            {TABS.map(({ to, label, Icon }) => (
              <NavLink
                key={to}
                to={to}
                end
                className={({ isActive }) =>
                  `flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                    isActive
                      ? "border-brand-500 text-navy"
                      : "border-transparent text-navy/50 hover:text-navy hover:border-surface-300"
                  }`
                }
              >
                <Icon size={14} />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </div>
      <Outlet />
    </div>
  );
}
