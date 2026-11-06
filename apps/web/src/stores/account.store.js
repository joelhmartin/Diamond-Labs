import { create } from "zustand";
import api from "../config/api.js";
import { getPermissionsForRole } from "@my-app/shared";

const SCOPE_KEY = "practiceScope";
const ALL = "all";

// sessionStorage can throw (private windows, blocked storage); the choice then just isn't remembered.
const readStoredScope = () => {
  try { return sessionStorage.getItem(SCOPE_KEY); } catch { return null; }
};
const writeStoredScope = (value) => {
  try { sessionStorage.setItem(SCOPE_KEY, value); } catch { /* not remembered */ }
};
const EMPTY_SCOPE = { accounts: [], organizations: [] };

/** A stored choice only counts while it is still one of the login's practices. */
const validScope = (scope, clientScope) =>
  scope && scope !== ALL && clientScope.accounts.some((a) => a.id === scope) ? scope : ALL;

export const useAccountStore = create((set, get) => ({
  /** The login's practices and groups (GET /client/scope). Fetched per session, never kept beyond it. */
  clientScope: EMPTY_SCOPE,
  clientScopeLoaded: false,
  /** "all" or one practice's account id. Remembered for the browser session only. */
  practiceScope: ALL,

  fetchClientScope: async () => {
    let clientScope = EMPTY_SCOPE;
    try {
      const { data } = await api.get("/client/scope");
      clientScope = { accounts: data.data?.accounts ?? [], organizations: data.data?.organizations ?? [] };
    } catch {
      // No scope reads as no practices: the lists then show only what the server returns for the login.
    }
    const practiceScope = validScope(readStoredScope(), clientScope);
    writeStoredScope(practiceScope);
    set({ clientScope, clientScopeLoaded: true, practiceScope });
    return clientScope;
  },

  setPracticeScope: (scope) => {
    const practiceScope = validScope(scope, get().clientScope);
    writeStoredScope(practiceScope);
    set({ practiceScope });
  },

  /** On sign-out: nothing about the previous login's practices stays in memory or storage. */
  clearClientScope: () => {
    writeStoredScope(ALL);
    set({ clientScope: EMPTY_SCOPE, clientScopeLoaded: false, practiceScope: ALL });
  },

  accounts: [],
  activeAccount: null,
  isLoading: false,

  fetchAccounts: async () => {
    set({ isLoading: true });
    try {
      const { data } = await api.get("/user/me/accounts");
      const accounts = data.data;
      set({ accounts, isLoading: false });

      // Restore active account from sessionStorage or default to first
      const savedId = sessionStorage.getItem("activeAccountId");
      const saved = accounts.find((a) => a.accountId === savedId);
      if (saved) {
        set({ activeAccount: saved });
      } else if (accounts.length > 0) {
        set({ activeAccount: accounts[0] });
        sessionStorage.setItem("activeAccountId", accounts[0].accountId);
      }
    } catch {
      set({ accounts: [], isLoading: false });
    }
  },

  switchAccount: (accountId) => {
    const account = get().accounts.find((a) => a.accountId === accountId);
    if (account) {
      set({ activeAccount: account });
      sessionStorage.setItem("activeAccountId", accountId);
    }
  },

  createAccount: async ({ name, slug }) => {
    const { data } = await api.post("/accounts", { name, slug });
    await get().fetchAccounts();
    return data.data;
  },

  getPermissions: () => {
    const { activeAccount } = get();
    if (!activeAccount) return [];
    return getPermissionsForRole(activeAccount.role);
  },
}));
