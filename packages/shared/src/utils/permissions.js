import { getRoleBySlug } from "../constants/roles.js";

/**
 * Check if a set of permissions includes the required permission.
 * Supports wildcard matching:
 *   - "*" matches everything
 *   - "resources:*" matches "resources:read", "resources:create", etc.
 */
export function hasPermission(permissions, required) {
  if (!permissions || !required) return false;

  // Wildcard — full access
  if (permissions.includes("*")) return true;

  // Exact match
  if (permissions.includes(required)) return true;

  // Resource wildcard match: "resources:*" covers "resources:read"
  const [resource] = required.split(":");
  if (permissions.includes(`${resource}:*`)) return true;

  return false;
}

/**
 * Check if a role slug has a specific permission.
 */
export function roleHasPermission(roleSlug, required) {
  const role = getRoleBySlug(roleSlug);
  if (!role) return false;
  return hasPermission(role.permissions, required);
}

/**
 * Get all permissions for a role slug.
 */
export function getPermissionsForRole(roleSlug) {
  const role = getRoleBySlug(roleSlug);
  return role ? role.permissions : [];
}

/**
 * Create a `can()` function bound to a specific role.
 */
export function createPermissionChecker(roleSlug) {
  return (required) => roleHasPermission(roleSlug, required);
}
