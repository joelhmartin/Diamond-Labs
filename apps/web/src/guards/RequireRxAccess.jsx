import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.js";
import { Spinner } from "../components/ui/Spinner.jsx";
import { ROUTES } from "../config/routes.js";

/**
 * Guard for the faithful Rx forms (/app/rx*). Admits **admins** (for
 * testing/oversight) AND **approved doctors**. Mirrors RequireDoctor but does
 * not bounce admins to the dashboard.
 */
export function RequireRxAccess() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to={ROUTES.LOGIN} state={{ from: location }} replace />;
  }

  if (user?.role === "admin") return <Outlet />;

  if (user?.role === "doctor" && user?.approvalStatus === "pending") {
    return <Navigate to={ROUTES.REGISTER_PENDING} replace />;
  }

  if (user?.role === "doctor" && user?.approvalStatus === "approved") {
    return <Outlet />;
  }

  return <Navigate to={ROUTES.DASHBOARD} replace />;
}
