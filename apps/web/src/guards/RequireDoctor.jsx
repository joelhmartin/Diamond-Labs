import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.js";
import { Spinner } from "../components/ui/Spinner.jsx";
import { ROUTES } from "../config/routes.js";

export function RequireDoctor() {
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

  if (user?.role === "doctor" && user?.approvalStatus === "pending") {
    return <Navigate to={ROUTES.REGISTER_PENDING} replace />;
  }

  if (user?.role !== "doctor" || user?.approvalStatus !== "approved") {
    return <Navigate to={ROUTES.DASHBOARD} replace />;
  }

  return <Outlet />;
}
