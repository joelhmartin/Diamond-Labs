/** An organization rule refusal; `code` maps to an HTTP status in routes.js. */
export class OrganizationError extends Error {
  /** @param {"NOT_FOUND"|"INVALID"|"CONFLICT"} code @param {string} message safe to show staff */
  constructor(code, message) {
    super(message);
    this.name = "OrganizationError";
    this.code = code;
  }
}

/**
 * Which accounts a user can see, and why. Pure.
 *
 * - `memberships`: `[{ accountId, role, status, accountActive, accountEligible }]` (the user's own rows)
 * - `adminOf`: `[{ organizationId, status, organizationActive }]` (the user's organization-admin grants)
 * - `orgAccounts`: `[{ organizationId, accountId, accountActive, accountEligible }]` (accounts of those organizations)
 *
 * Only active memberships/grants of active, eligible accounts count. An
 * organization-admin grant wins over a member role for `roles` and `via`.
 *
 * @returns {{ accountIds: string[], roles: Map<string,string>, via: Map<string,"member"|"org-admin">,
 *             organizations: { id: string, accountIds: string[] }[] }}
 */
export function resolveScope({ memberships = [], adminOf = [], orgAccounts = [] }) {
  const roles = new Map();
  const via = new Map();
  for (const m of memberships) {
    if (m.status !== "active" || !m.accountActive || !m.accountEligible) continue;
    roles.set(m.accountId, m.role);
    via.set(m.accountId, "member");
  }
  const grantedOrgs = new Set(adminOf.filter((g) => g.status === "active" && g.organizationActive).map((g) => g.organizationId));
  const byOrg = new Map();
  for (const a of orgAccounts) {
    if (!grantedOrgs.has(a.organizationId) || !a.accountActive || !a.accountEligible) continue;
    roles.set(a.accountId, "org-admin");
    via.set(a.accountId, "org-admin");
    if (!byOrg.has(a.organizationId)) byOrg.set(a.organizationId, new Set());
    byOrg.get(a.organizationId).add(a.accountId);
  }
  const organizations = [...grantedOrgs].sort().map((id) => ({ id, accountIds: [...(byOrg.get(id) ?? [])].sort() }));
  return { accountIds: [...roles.keys()].sort(), roles, via, organizations };
}

/** True when the scope includes `accountId` through an organization-admin grant. */
export const mayAdminister = (scope, accountId) => scope?.via?.get(accountId) === "org-admin";
