import { useAccountStore } from "../stores/account.store.js";
import { isPortalLogin, roleHome } from "../config/routes.js";

/**
 * Where a login goes right after signing in (password or MFA). A practice login that is
 * neither doctor nor staff needs its scope to know it belongs in the portal, so the scope
 * is read here; everyone else goes straight to roleHome. The ONE post-auth landing rule.
 */
export async function homeAfterAuth(user) {
  const hasPractices = isPortalLogin(user) ? (await useAccountStore.getState().fetchClientScope()).accounts.length > 0 : false;
  return roleHome(user, { hasPractices });
}

/** The same landing rule for a component that redirects a wrong-area visitor: { home, pending } (pending = scope still loading). */
export function useRoleHome(user) {
  const loaded = useAccountStore((s) => s.clientScopeLoaded);
  const hasPractices = useAccountStore((s) => s.clientScope.accounts.length > 0);
  const pending = Boolean(user) && isPortalLogin(user) && !loaded;
  return { home: roleHome(user, { hasPractices }), pending };
}
