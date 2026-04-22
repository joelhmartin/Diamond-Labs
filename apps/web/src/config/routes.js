export const ROUTES = {
  // Auth
  LOGIN: "/auth/login",
  REGISTER: "/auth/register",
  REGISTER_DOCTOR: "/auth/register/doctor",
  REGISTER_PENDING: "/auth/register/pending",
  FORGOT_PASSWORD: "/auth/forgot-password",
  RESET_PASSWORD: "/auth/reset-password",
  VERIFY_EMAIL: "/auth/verify-email",
  MAGIC_LINK: "/auth/magic-link",
  ACCEPT_INVITE: "/auth/accept-invite",
  OAUTH_CALLBACK: "/auth/oauth-callback",

  // User
  DASHBOARD: "/dashboard",
  SETTINGS: "/settings",
  MEMBERS: "/members",

  // Admin
  ADMIN: "/admin",
  ADMIN_PRODUCTS: "/admin/products",
  ADMIN_INVOICES: "/admin/invoices",

  // Doctor
  DOCTOR_INVOICES: "/doctor/invoices",
  DOCTOR_SAVED_CARDS: "/doctor/saved-cards",

  // Commerce
  CHECKOUT: "/checkout",
};

/**
 * Given the current user, return the URL that should serve as their "home"
 * after login / when they click a profile link from the navbar.
 */
export function roleHome(user) {
  if (!user) return ROUTES.LOGIN;
  if (user.role === "admin") return ROUTES.ADMIN_INVOICES;
  if (user.role === "doctor") {
    if (user.approvalStatus === "pending") return ROUTES.REGISTER_PENDING;
    if (user.approvalStatus === "approved") return ROUTES.DOCTOR_INVOICES;
  }
  return ROUTES.DASHBOARD;
}
