import { create } from "zustand";
import api from "../config/api.js";

// ─── Automatic idle logoff (HIPAA §164.312(a)(2)(iii)) ─────────────────────────
// Force logout after this much inactivity. Kept here so the watcher is armed
// automatically whenever the user is authenticated — no component wiring needed
// (see the store.subscribe at the bottom of this file). A thin useIdleLogout()
// hook also exists for explicit shell-level mounting; both paths are idempotent.
export const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const ACTIVITY_DEBOUNCE_MS = 1000; // reset the timer at most once per second
const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "click",
  "scroll",
  "touchstart",
  "wheel",
];

let idleTimerId = null;
let idleListenersAttached = false;
let idleActivityHandler = null;
let lastActivityReset = 0;

function armIdleTimer(onIdle) {
  if (typeof window === "undefined") return;
  clearTimeout(idleTimerId);
  idleTimerId = setTimeout(onIdle, IDLE_TIMEOUT_MS);
}

export const useAuthStore = create((set, get) => ({
  user: null,
  accessToken: null,
  isAuthenticated: false,
  isLoading: true,

  setAccessToken: (token) => set({ accessToken: token }),

  setUser: (user) => set({ user, isAuthenticated: !!user, isLoading: false }),

  login: async ({ email, password }) => {
    const { data } = await api.post("/auth/login", { email, password });
    if (data.data.pendingApproval) {
      return { pendingApproval: true };
    }
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

  registerDoctor: async (formData) => {
    const { data } = await api.post("/auth/register/doctor", formData);
    return data.data;
  },

  isApprovedDoctor: () => {
    const user = get().user;
    return user?.role === "doctor" && user?.approvalStatus === "approved";
  },

  isAdmin: () => {
    const user = get().user;
    return user?.role === "admin";
  },

  logout: async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // ignore logout errors
    }
    set({ user: null, accessToken: null, isAuthenticated: false });
  },

  // Automatic idle logoff (HIPAA §164.312(a)(2)(iii)). Clears auth state and
  // revokes the refresh cookie, then hard-redirects to login with a flag the
  // login page can surface ("You were signed out due to inactivity"). A hard
  // redirect (over React Router navigation) guarantees all in-memory PHI in the
  // SPA is dropped.
  idleLogout: async () => {
    // Only act if actually authenticated — avoids redirect loops on public pages.
    if (!get().isAuthenticated) return;
    get().stopIdleWatch();
    try {
      await api.post("/auth/logout");
    } catch {
      // ignore logout errors — we still clear local state below
    }
    set({ user: null, accessToken: null, isAuthenticated: false });
    if (typeof window !== "undefined") {
      window.location.assign("/auth/login?reason=idle");
    }
  },

  // Start the inactivity watcher. Idempotent — safe to call from both the
  // auto-subscription below and the useIdleLogout() hook.
  startIdleWatch: () => {
    if (typeof window === "undefined" || idleListenersAttached) return;
    idleListenersAttached = true;

    const onActivity = () => {
      const now = Date.now();
      if (now - lastActivityReset < ACTIVITY_DEBOUNCE_MS) return; // debounce
      lastActivityReset = now;
      armIdleTimer(() => get().idleLogout());
    };
    // Stash the handler at module scope so stopIdleWatch detaches this exact ref.
    idleActivityHandler = onActivity;

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, onActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", onActivity);

    armIdleTimer(() => get().idleLogout()); // start the countdown now
  },

  // Stop the watcher and detach all listeners. Idempotent.
  stopIdleWatch: () => {
    if (typeof window === "undefined") return;
    clearTimeout(idleTimerId);
    idleTimerId = null;
    if (idleActivityHandler) {
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, idleActivityHandler);
      }
      document.removeEventListener("visibilitychange", idleActivityHandler);
    }
    idleActivityHandler = null;
    idleListenersAttached = false;
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

// Arm/disarm the idle-logoff watcher automatically as auth state changes, so the
// HIPAA auto-logoff works without any component having to mount a hook. Runs
// only in the browser. Both start/stopIdleWatch are idempotent.
if (typeof window !== "undefined") {
  useAuthStore.subscribe((state, prevState) => {
    if (state.isAuthenticated && !prevState.isAuthenticated) {
      state.startIdleWatch();
    } else if (!state.isAuthenticated && prevState.isAuthenticated) {
      state.stopIdleWatch();
    }
  });
}
