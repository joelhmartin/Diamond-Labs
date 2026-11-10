import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.js";
import { roleHome, usesAppShell } from "../config/routes.js";

/** Sends doctors (approved or pending) to their own home instead of the staff app shell. */
export function RequireAppShellUser({ children }) {
  const { user } = useAuth();
  if (user && !usesAppShell(user)) return <Navigate to={roleHome(user)} replace />;
  return children;
}
