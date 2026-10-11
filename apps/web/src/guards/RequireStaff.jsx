import { STAFF_ROLES } from "@my-app/shared";
import { RequireUserRole } from "./RequireUserRole.jsx";

/** Lab staff and admins: the production board, lab orders and Rx cases. */
export function RequireStaff() {
  return <RequireUserRole roles={STAFF_ROLES} />;
}
