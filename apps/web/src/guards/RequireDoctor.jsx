import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.js";
import { Spinner } from "../components/ui/Spinner.jsx";
import { ROUTES, isPortalLogin } from "../config/routes.js";
import { useAccountStore } from "../stores/account.store.js";

export function RequireDoctor() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();
  const scopeLoaded = useAccountStore((s) => s.clientScopeLoaded);
  const hasPractices = useAccountStore((s) => s.clientScope.accounts.length > 0);
  // A non-doctor login (practice staff, a group's owner) reaches the portal through its practices.
  const awaitingScope = isAuthenticated && user && isPortalLogin(user) && !scopeLoaded;

  if (isLoading || awaitingScope) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to={ROUTES.LOGIN} state={{ from: location }} replace />;
  }

  if (user?.role === "doctor" && user?.approvalStatus === "pending") {
    return <Navigate to={ROUTES.REGISTER_PENDING} replace />;
  }

  if (isPortalLogin(user) && hasPractices) return <Outlet />;

  if (user?.role !== "doctor" || user?.approvalStatus !== "approved") {
    return <Navigate to={ROUTES.DASHBOARD} replace />;
  }

  return <Outlet />;
}
