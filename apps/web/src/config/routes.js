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
  ADMIN_RX_CASES: "/admin/rx-cases",
  ADMIN_RX_CASE_DETAIL: "/admin/rx-cases/:id",
  ADMIN_AUTOPAY: "/admin/autopay",
  ADMIN_JOBS: "/admin/jobs",

  // Doctor
  DOCTOR_INVOICES: "/doctor/invoices",
  DOCTOR_PAYMENTS: "/doctor/payments",
  DOCTOR_SAVED_CARDS: "/doctor/saved-cards",
  DOCTOR_AUTOPAY: "/doctor/autopay",
  DOCTOR_ACCOUNT: "/doctor/account",
  DOCTOR_NEW_CASE: "/app/cases/new",

  // Rx forms (faithful 1:1 JotForm ports)
  RX_CHOOSER: "/app/rx",
  RX_DIGITAL: "/app/rx/digital",
  RX_ORTHO: "/app/rx/ortho",

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

/** Whether a home path is a portal one (doctor or pending), not the staff app shell (/dashboard, /settings, ...). */
export function isPortalHome(home) {
  return PORTAL_HOMES.includes(home);
}

/** Where the account menu's settings link goes for a given home; null when there is none (pending doctors). */
export function accountPathFor(home) {
  if (home === ROUTES.REGISTER_PENDING) return null;
  return home === ROUTES.DOCTOR_INVOICES ? ROUTES.DOCTOR_ACCOUNT : ROUTES.SETTINGS;
}

const PORTAL_HOMES = [ROUTES.DOCTOR_INVOICES, ROUTES.REGISTER_PENDING];
