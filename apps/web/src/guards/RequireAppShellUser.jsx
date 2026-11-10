import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.js";
import { useRoleHome } from "../lib/post-auth.js";
import { isPortalHome } from "../config/routes.js";
import { Spinner } from "../components/ui/Spinner.jsx";

/** Sends portal logins (doctors, practice staff, pending doctors) to their own home instead of the staff app shell. */
export function RequireAppShellUser({ children }) {
  const { user } = useAuth();
  const { home, pending } = useRoleHome(user);
  if (pending) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }
  if (user && isPortalHome(home)) return <Navigate to={home} replace />;
  return children;
}
