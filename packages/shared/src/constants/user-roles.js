/**
 * The single definition of "who is staff" (lab technicians and admins).
 * Server guards and web route gates both read this; never re-list the roles.
 */
export const STAFF_ROLES = Object.freeze(["admin", "lab"]);

export function isStaffRole(role) {
  return STAFF_ROLES.includes(role);
}

/**
 * The ONE definition of the lab-access toggle on Admin › Users. Only these
 * two roles are granted or removed from there: admins are made by
 * db/create-admin.js and doctors by the approval flow, so the role route
 * must never become a back door into either. The API refuses with
 * roleChangeRefusal, the UI offers roleToggleFor, the request schema
 * validates against ROLE_CHANGE_CHOICES.
 */
export const ROLE_CHANGE_CHOICES = Object.freeze(["lab", "user"]);

/** The toggle button for `user`, or null when the actor may not change them. */
export function roleToggleFor(user, actorId) {
  if (user.id === actorId) return null;
  if (user.role === "user") return { role: "lab", label: "Make lab staff" };
  if (user.role === "lab") return { role: "user", label: "Remove lab access" };
  return null;
}

/** Why `actorId` may not set `target` to `role`; null when allowed. */
export function roleChangeRefusal({ actorId, target, role }) {
  if (!ROLE_CHANGE_CHOICES.includes(role)) return "Only lab staff access can be granted or removed here.";
  if (target.id === actorId) return "You can't change your own role.";
  if (!ROLE_CHANGE_CHOICES.includes(target.role)) return "Admin and doctor accounts can't be changed here.";
  return null;
}
