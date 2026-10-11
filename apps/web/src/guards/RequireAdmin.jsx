import { RequireUserRole } from "./RequireUserRole.jsx";

export function RequireAdmin() {
  return <RequireUserRole roles={["admin"]} />;
}
