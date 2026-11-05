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
  ADMIN_PRICE_LISTS: "/admin/price-lists",
  ADMIN_PRICE_LIST_DETAIL: "/admin/price-lists/:id",
  ADMIN_INVOICES: "/admin/invoices",
  ADMIN_INVOICE_DETAIL: "/admin/invoices/:id",
  ADMIN_RECEIVABLES: "/admin/receivables",
  ADMIN_PAYMENTS: "/admin/payments",
  ADMIN_EXPORTS: "/admin/exports",
  ADMIN_ORDERS: "/admin/orders",
  ADMIN_USERS: "/admin/users",
  ADMIN_CLIENT_PRICING: "/admin/users/:userId/pricing",
  ADMIN_RX_MAPPING: "/admin/rx-mapping",
  ADMIN_RX_CASES: "/admin/rx-cases",
  ADMIN_RX_CASE_DETAIL: "/admin/rx-cases/:id",
  ADMIN_AUTOPAY: "/admin/autopay",
  ADMIN_JOBS: "/admin/jobs",
  ADMIN_DEPARTMENTS: "/admin/lab/departments",
  ADMIN_REASONS: "/admin/lab/adjustment-reasons",
  ADMIN_SHIPMENTS: "/admin/shipments",
  ADMIN_SCHEDULING: "/admin/scheduling",
  ADMIN_LABELS: "/admin/labels",

  // Lab (admin + lab staff)
  LAB_BOARD: "/lab",
  LAB_CALENDAR: "/lab/calendar",
  LAB_INTAKE: "/lab/intake",
  LAB_ORDER_NEW: "/lab/orders/new", // declared before LAB_ORDER_DETAIL so "new" is never read as an id
  LAB_ORDER_DETAIL: "/lab/orders/:id",
  LAB_SHIPMENT_PRINT: "/lab/shipments/:id/print",

  // Reports (admin + lab staff; each report narrows further by role)
  REPORTS: "/reports",
  REPORT: "/reports/:key",
  // Dashboards (staff; tiles narrow further by role). Not ROUTES.DASHBOARD: that is the account home.
  LAB_DASHBOARD_HOME: "/lab/dashboard",
  LAB_DASHBOARD: "/lab/dashboard/:key",

  // Doctor
  DOCTOR_INVOICES: "/doctor/invoices",
  DOCTOR_INVOICE_DETAIL: "/doctor/invoices/:id",
  DOCTOR_PAYMENTS: "/doctor/payments",
  DOCTOR_SAVED_CARDS: "/doctor/saved-cards",
  DOCTOR_AUTOPAY: "/doctor/autopay",
  DOCTOR_CASES: "/doctor/cases",
  DOCTOR_NEW_CASE: "/app/cases/new",

  // Rx forms (faithful 1:1 JotForm ports)
  RX_CHOOSER: "/app/rx",
  RX_DIGITAL: "/app/rx/digital",
  RX_ORTHO: "/app/rx/ortho",

  // Commerce
  CHECKOUT: "/checkout",
};

export const labOrderPath = (id) => `/lab/orders/${id}`;
export const doctorInvoicePath = (id) => `/doctor/invoices/${id}`;
export const adminInvoicePath = (id) => `/admin/invoices/${id}`;
export const shipmentPrintPath = (id) => `/lab/shipments/${id}/print`;
export const reportPath = (key) => `/reports/${encodeURIComponent(key)}`;
export const dashboardPath = (key) => `/lab/dashboard/${encodeURIComponent(key)}`;

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
  if (user.role === "lab") return ROUTES.LAB_BOARD;
  // Admins land on the lab dashboards (Pulse).
  if (user.role === "admin") return ROUTES.LAB_DASHBOARD_HOME;
  // Everyone else lands on the account dashboard.
  return ROUTES.DASHBOARD;
}
