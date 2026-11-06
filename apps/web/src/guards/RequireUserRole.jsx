import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.js";
import { Spinner } from "../components/ui/Spinner.jsx";
import { ROUTES } from "../config/routes.js";
import { useRoleHome } from "../lib/post-auth.js";

/**
 * Gate on the user's own role (users.role), not their account membership
 * (see RequireRole). Signed-out users go to login; wrong role goes to their own
 * role home (a lab user never lands on the admin dashboard).
 */
export function RequireUserRole({ roles }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();
  const { home, pending } = useRoleHome(user);

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

  if (!roles.includes(user?.role)) {
    if (pending) return <div className="flex h-screen items-center justify-center"><Spinner size="lg" /></div>;
    return <Navigate to={home} replace />;
  }

  return <Outlet />;
}
