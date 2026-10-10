export { STAFF_ROLES } from "@my-app/shared";

/**
 * Which user roles an admin may grant from the Users page. Only lab access
 * is granted or removed here; admins are made by db/create-admin.js and
 * doctors by the approval flow — this route must never become a back door
 * into either.
 */
export const STAFF_ROLE_CHOICES = ["lab", "user"];

export function roleChangeRefusal({ actorId, target, role }) {
  if (!STAFF_ROLE_CHOICES.includes(role)) return "Only lab staff access can be granted or removed here.";
  if (target.id === actorId) return "You can't change your own role.";
  if (!STAFF_ROLE_CHOICES.includes(target.role)) return "Admin and doctor accounts can't be changed here.";
  return null;
}
