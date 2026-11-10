import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.js";
import { isPortalHome, roleHome } from "../config/routes.js";

/** Sends doctors (approved or pending) to their own home instead of the staff app shell. */
export function RequireAppShellUser({ children }) {
  const { user } = useAuth();
  const home = roleHome(user);
  if (user && isPortalHome(home)) return <Navigate to={home} replace />;
  return children;
}
