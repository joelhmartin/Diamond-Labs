import { useAccountStore } from "../stores/account.store.js";

/**
 * Which practice(s) the client portal is showing: "all" or one account id.
 * The ONE place a page gets its `?account=` value, so every list agrees.
 *
 *   scope     "all" | accountId
 *   accounts  the login's practices ([{ id, name, accountNumber, organizationId, via, role, payable }])
 *   isAll     scope === "all"
 *   param     the `account` query value for list calls (undefined = the whole scope)
 *   loaded    the scope has been fetched (a create form must not decide before this)
 *   multi     more than one practice: the switcher, Practice columns and filters appear
 *   set(id)   choose a practice, or "all"
 */
export function usePracticeScope() {
  const scope = useAccountStore((s) => s.practiceScope);
  const accounts = useAccountStore((s) => s.clientScope.accounts);
  const organizations = useAccountStore((s) => s.clientScope.organizations);
  const loaded = useAccountStore((s) => s.clientScopeLoaded);
  const set = useAccountStore((s) => s.setPracticeScope);
  const isAll = scope === "all";
  return { scope, accounts, organizations, isAll, param: isAll ? undefined : scope, multi: accounts.length > 1, loaded, set };
}
