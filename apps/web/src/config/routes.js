export const ROUTES = {
  // Auth
  LOGIN: "/auth/login",
  REGISTER: "/auth/register",
  REGISTER_DOCTOR: "/auth/register/doctor",
  REGISTER_PENDING: "/auth/register/pending",
  FORGOT_PASSWORD: "/auth/forgot-password",
  RESET_PASSWORD: "/auth/reset-password",
  VERIFY_EMAIL: "/auth/verify-email",
  ACCEPT_INVITE: "/auth/accept-invite",

  // User
  DASHBOARD: "/dashboard",
  SETTINGS: "/settings",
  MEMBERS: "/members",

  // Admin
  ADMIN: "/admin",
  ADMIN_PRODUCTS: "/admin/products",
  ADMIN_INVOICES: "/admin/invoices",
  ADMIN_PAYMENTS: "/admin/payments",
  ADMIN_ORDERS: "/admin/orders",
  ADMIN_USERS: "/admin/users",
  ADMIN_RX_MAPPING: "/admin/rx-mapping",

  // Doctor
  DOCTOR_INVOICES: "/doctor/invoices",
  DOCTOR_PAYMENTS: "/doctor/payments",
  DOCTOR_SAVED_CARDS: "/doctor/saved-cards",
  DOCTOR_NEW_CASE: "/app/cases/new",

  // Rx forms (faithful 1:1 JotForm ports)
  RX_CHOOSER: "/app/rx",
  RX_DIGITAL: "/app/rx/digital",
  RX_ORTHO: "/app/rx/ortho",
  RX_OLMOS: "/app/rx/olmos",

  // Commerce
  CHECKOUT: "/checkout",
};

/**
 * Given the current user, return the URL that should serve as their "home"
 * after login / when they click a profile link from the navbar.
 */
export function roleHome(user) {
  if (!user) return ROUTES.LOGIN;
  // Doctors with an active portal go straight to invoices.
  if (user.role === "doctor") {
    if (user.approvalStatus === "pending") return ROUTES.REGISTER_PENDING;
    if (user.approvalStatus === "approved") return ROUTES.DOCTOR_INVOICES;
  }
  // Everyone else (including admin) lands on the dashboard; the sidebar
  // surfaces role-specific sections like /admin/*.
  return ROUTES.DASHBOARD;
}
