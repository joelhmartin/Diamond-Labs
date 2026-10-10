/**
 * The single definition of "who is staff" (lab technicians and admins).
 * Server guards and web route gates both read this; never re-list the roles.
 */
export const STAFF_ROLES = Object.freeze(["admin", "lab"]);

export function isStaffRole(role) {
  return STAFF_ROLES.includes(role);
}
