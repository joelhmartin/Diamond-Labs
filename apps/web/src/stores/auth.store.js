import { create } from "zustand";
import api from "../config/api.js";

export const useAuthStore = create((set, get) => ({
  user: null,
  accessToken: null,
  isAuthenticated: false,
  isLoading: true,

  setAccessToken: (token) => set({ accessToken: token }),

  setUser: (user) => set({ user, isAuthenticated: !!user, isLoading: false }),

  login: async ({ email, password }) => {
    const { data } = await api.post("/auth/login", { email, password });
    if (data.data.mfaRequired) {
      return { mfaRequired: true, mfaToken: data.data.mfaToken };
    }
    set({ user: data.data.user, accessToken: data.data.accessToken, isAuthenticated: true });
    return data.data;
  },

  register: async ({ email, password, name }) => {
    const { data } = await api.post("/auth/register", { email, password, name });
    set({ user: data.data.user, accessToken: data.data.accessToken, isAuthenticated: true });
    return data.data;
  },

  logout: async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // ignore logout errors
    }
    set({ user: null, accessToken: null, isAuthenticated: false });
  },

  refresh: async () => {
    try {
      const { data } = await api.post("/auth/refresh");
      set({ accessToken: data.data.accessToken });
      // Fetch user profile
      const profile = await api.get("/user/me");
      set({ user: profile.data.data, isAuthenticated: true, isLoading: false });
    } catch {
      set({ user: null, accessToken: null, isAuthenticated: false, isLoading: false });
    }
  },

  verifyMfa: async ({ mfaToken, code }) => {
    const { data } = await api.post("/auth/mfa/verify", { mfaToken, code });
    set({ user: data.data.user, accessToken: data.data.accessToken, isAuthenticated: true });
    return data.data;
  },
}));
