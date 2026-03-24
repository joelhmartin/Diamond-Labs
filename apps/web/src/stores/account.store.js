import { create } from "zustand";
import api from "../config/api.js";
import { getPermissionsForRole } from "@my-app/shared";

export const useAccountStore = create((set, get) => ({
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
