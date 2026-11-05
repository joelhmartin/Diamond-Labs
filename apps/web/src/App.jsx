import { useEffect, useLayoutEffect, useRef, lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);
import { ToastProvider } from "./components/ui/Toast.jsx";
import { useAuthStore } from "./stores/auth.store.js";
import { useAccountStore } from "./stores/account.store.js";
import { RequireAuth } from "./guards/RequireAuth.jsx";
import { RequireAccount } from "./guards/RequireAccount.jsx";
import { AppShell } from "./components/layout/AppShell.jsx";
import { DoctorShell } from "./components/layout/DoctorShell.jsx";
import { resetScrollPositions } from "./lib/scroll.js";

// Auth pages
import { LoginPage } from "./pages/auth/LoginPage.jsx";
import { RegisterPage } from "./pages/auth/RegisterPage.jsx";
import { ForgotPasswordPage } from "./pages/auth/ForgotPasswordPage.jsx";
import { ResetPasswordPage } from "./pages/auth/ResetPasswordPage.jsx";
import { VerifyEmailPage } from "./pages/auth/VerifyEmailPage.jsx";
import { AcceptInvitePage } from "./pages/auth/AcceptInvitePage.jsx";
import { DoctorRegisterPage } from "./pages/auth/DoctorRegisterPage.jsx";
import { DoctorPendingPage } from "./pages/auth/DoctorPendingPage.jsx";

// App pages
import { DashboardPage } from "./pages/app/DashboardPage.jsx";
import { SettingsPage } from "./pages/app/SettingsPage.jsx";
import { MembersPage } from "./pages/app/MembersPage.jsx";
import { AdminCatalogPage } from "./pages/app/AdminCatalogPage.jsx";
import { AdminInvoicesPage } from "./pages/app/AdminInvoicesPage.jsx";
import { AdminInvoiceDetailPage } from "./pages/app/AdminInvoiceDetailPage.jsx";
import { AdminReceivablesPage } from "./pages/app/AdminReceivablesPage.jsx";
import { AdminPaymentsPage } from "./pages/app/AdminPaymentsPage.jsx";
import { AdminExportsPage } from "./pages/app/AdminExportsPage.jsx";
import { AdminUsersPage } from "./pages/app/AdminUsersPage.jsx";
import { AdminClientPricingPage } from "./pages/app/AdminClientPricingPage.jsx";
import { AdminPriceListsPage } from "./pages/app/AdminPriceListsPage.jsx";
import { AdminPriceListEditorPage } from "./pages/app/AdminPriceListEditorPage.jsx";
import { AdminAutoPayPage } from "./pages/app/AdminAutoPayPage.jsx";
import { AdminJobsPage } from "./pages/app/AdminJobsPage.jsx";
import { AdminLabAlertsPage } from "./pages/app/AdminLabAlertsPage.jsx";
import { NotificationsPage } from "./pages/app/NotificationsPage.jsx";
import { AdminOrdersPage } from "./pages/app/AdminOrdersPage.jsx";
import { AdminDepartmentsPage } from "./pages/app/AdminDepartmentsPage.jsx";
import { AdminAdjustmentReasonsPage } from "./pages/app/AdminAdjustmentReasonsPage.jsx";
import { ShipmentsPage } from "./pages/lab/ShipmentsPage.jsx";
import { ShipmentLabelPrintPage } from "./pages/lab/ShipmentLabelPrintPage.jsx";
import { MyCasesPage } from "./pages/doctor/MyCasesPage.jsx";
import { AdminRxMappingPage } from "./pages/app/AdminRxMappingPage.jsx";
import { AdminRxCasesPage } from "./pages/app/AdminRxCasesPage.jsx";
import { AdminRxCaseDetailPage } from "./pages/app/AdminRxCaseDetailPage.jsx";
import { RequireAdmin } from "./guards/RequireAdmin.jsx";
import { RequireStaff } from "./guards/RequireStaff.jsx";
import { LabBoardPage } from "./pages/lab/LabBoardPage.jsx";
import { LabOrderDetailPage } from "./pages/lab/LabOrderDetailPage.jsx";
import { LabMessagesPage } from "./pages/lab/LabMessagesPage.jsx";
import { LabThreadPage } from "./pages/lab/LabThreadPage.jsx";
import { MessagesPage } from "./pages/doctor/MessagesPage.jsx";
import { PickupsPage } from "./pages/doctor/PickupsPage.jsx";
import { LabPickupsPage } from "./pages/lab/LabPickupsPage.jsx";
import { DeliveriesPage } from "./pages/lab/DeliveriesPage.jsx";
import { DeliveryRoutePrintPage } from "./pages/lab/DeliveryRoutePrintPage.jsx";
import { ThreadPage } from "./pages/doctor/ThreadPage.jsx";
import { OrdersCalendarPage } from "./pages/lab/OrdersCalendarPage.jsx";
import { AdminSchedulingPage } from "./pages/app/AdminSchedulingPage.jsx";
import { AdminLabelsPage } from "./pages/app/AdminLabelsPage.jsx";
import { NewLabOrderPage } from "./pages/lab/NewLabOrderPage.jsx";
import { IntakePage } from "./pages/lab/IntakePage.jsx";

// Marketing pages
import { HomePage } from "./pages/marketing/Home.jsx";
import { AboutPage } from "./pages/marketing/About.jsx";
import { ProductPage } from "./pages/marketing/Product.jsx";
import { ContactPage } from "./pages/marketing/Contact.jsx";
import { CaseSubmissionPage } from "./pages/marketing/CaseSubmission.jsx";
import { InstructionalVideosPage } from "./pages/marketing/InstructionalVideos.jsx";
import { ComingSoonPage } from "./pages/marketing/ComingSoon.jsx";
import { DownloadsPage } from "./pages/marketing/Downloads.jsx";
import { TeamPage } from "./pages/marketing/Team.jsx";
import { DrOlmosPage } from "./pages/marketing/DrOlmos.jsx";
import { TmdPage } from "./pages/marketing/Tmd.jsx";
import { SleepPage } from "./pages/marketing/Sleep.jsx";
import { CertifiedLabsPage } from "./pages/marketing/CertifiedLabs.jsx";
import { DigitalWorkflowPage } from "./pages/marketing/DigitalWorkflow.jsx";
import { RxInstructionsPage } from "./pages/marketing/RxInstructions.jsx";
import { CoursesPage } from "./pages/marketing/Courses.jsx";
import { CheckoutPage } from "./pages/marketing/Checkout.jsx";
import { Navbar } from "./components/marketing/Navbar.jsx";
import { Footer } from "./components/marketing/Footer.jsx";
import { CartWidget } from "./components/marketing/CartWidget.jsx";

// Doctor pages
import { InvoicesPage } from "./pages/doctor/InvoicesPage.jsx";
import { InvoiceDetailPage } from "./pages/doctor/InvoiceDetailPage.jsx";
import { PaymentsPage } from "./pages/doctor/PaymentsPage.jsx";
import { SavedCardsPage } from "./pages/doctor/SavedCardsPage.jsx";
import AutoPayPage from "./pages/doctor/AutoPayPage.jsx";
import { NewCasePage } from "./pages/app/NewCasePage.jsx";
import { RxChooserPage } from "./pages/app/RxChooserPage.jsx";
import { RxFormPage } from "./pages/app/RxFormPage.jsx";
import { RequireDoctor } from "./guards/RequireDoctor.jsx";
import { RequireRxAccess } from "./guards/RequireRxAccess.jsx";
import { ThemeEditor } from "./components/theme/ThemeEditor.jsx";

// Dev-only payment test harness. Lazily imported behind `import.meta.env.DEV` so
// Vite statically resolves this to `false` in production and dead-code-eliminates
// both the route and the component (it never reaches the prod bundle).
const PaymentTestPage = import.meta.env.DEV
  ? lazy(() => import("./pages/dev/PaymentTestPage.jsx").then((m) => ({ default: m.PaymentTestPage })))
  : null;

/* Scroll to top on route change, but NOT on initial load —
   that lets the browser restore scroll position on reload. */
function ScrollToTop() {
  const { pathname } = useLocation();
  const mounted = useRef(false);
  useLayoutEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    resetScrollPositions();
  }, [pathname]);
  return null;
}

/* Marketing layout: Navbar + page + Footer + floating cart */
function MarketingLayout() {
  const { pathname } = useLocation();

  // GSAP ScrollTrigger caches trigger positions on first measurement. If fonts,
  // images, or layout settle AFTER triggers register, those positions are stale
  // and `gsap.from` animations stay at opacity:0 forever. Refresh at every stage
  // where layout could shift: after children's effects, after fonts load, after
  // images load, and a final fallback for late-arriving content.
  useEffect(() => {
    const refresh = () => ScrollTrigger.refresh();
    const timers = [];

    // After children's useEffects have registered triggers (1-2 frames out).
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(refresh);
    });

    // After web fonts swap in (changes heading metrics → trigger offsets).
    if (document.fonts?.ready) {
      document.fonts.ready.then(refresh);
    }

    // After images / hero backgrounds load.
    const onLoad = () => refresh();
    if (document.readyState === "complete") {
      timers.push(setTimeout(refresh, 50));
    } else {
      window.addEventListener("load", onLoad);
    }

    // Final safety net for any straggler layout shift.
    timers.push(setTimeout(refresh, 600));

    return () => {
      cancelAnimationFrame(raf1);
      timers.forEach(clearTimeout);
      window.removeEventListener("load", onLoad);
    };
  }, [pathname]);

  return (
    <>
      <Navbar />
      <main>
        <Outlet />
      </main>
      <Footer />
      <CartWidget />
    </>
  );
}

function AppRoutes() {
  const refresh = useAuthStore((s) => s.refresh);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const fetchAccounts = useAccountStore((s) => s.fetchAccounts);

  // Silent refresh on mount
  useEffect(() => {
    refresh();
  }, []);

  // Fetch accounts when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      fetchAccounts();
    }
  }, [isAuthenticated]);

  return (
    <Routes>
      {/* Marketing routes */}
      <Route element={<MarketingLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/products" element={<ProductPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/submit-case" element={<CaseSubmissionPage />} />
        <Route path="/resources/videos" element={<InstructionalVideosPage />} />
        <Route path="/about/team" element={<TeamPage />} />
        <Route path="/about/dr-olmos" element={<DrOlmosPage />} />
        <Route path="/services/tmd" element={<TmdPage />} />
        <Route path="/services/sleep" element={<SleepPage />} />
        <Route path="/resources/certified-labs" element={<CertifiedLabsPage />} />
        <Route path="/resources/downloads" element={<DownloadsPage />} />
        <Route path="/services/digital-workflow" element={<DigitalWorkflowPage />} />
        <Route path="/resources/rx-instructions" element={<RxInstructionsPage />} />
        <Route path="/resources/courses" element={<CoursesPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        {/* Coming soon */}
        <Route path="/resources/new-client" element={<ComingSoonPage />} />
      </Route>

      {/* Auth routes */}
      <Route path="/auth/login" element={<LoginPage />} />
      <Route path="/auth/register" element={<RegisterPage />} />
      <Route path="/auth/register/doctor" element={<DoctorRegisterPage />} />
      <Route path="/auth/register/pending" element={<DoctorPendingPage />} />
      <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
      <Route path="/auth/verify-email" element={<VerifyEmailPage />} />
      <Route path="/auth/accept-invite" element={<AcceptInvitePage />} />

      {/* Protected app routes (top-level — no /app prefix) */}
      <Route
        element={
          <RequireAuth>
            <RequireAccount>
              <AppShell />
            </RequireAccount>
          </RequireAuth>
        }
      >
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/members" element={<MembersPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route element={<RequireAdmin />}>
          <Route path="/admin" element={<Navigate to="/admin/invoices" replace />} />
          <Route path="/admin/products" element={<AdminCatalogPage />} />
          <Route path="/admin/price-lists" element={<AdminPriceListsPage />} />
          <Route path="/admin/price-lists/:id" element={<AdminPriceListEditorPage />} />
          <Route path="/admin/invoices" element={<AdminInvoicesPage />} />
          <Route path="/admin/invoices/:id" element={<AdminInvoiceDetailPage />} />
          <Route path="/admin/receivables" element={<AdminReceivablesPage />} />
          <Route path="/admin/payments" element={<AdminPaymentsPage />} />
          <Route path="/admin/exports" element={<AdminExportsPage />} />
          <Route path="/admin/orders" element={<AdminOrdersPage />} />
          <Route path="/admin/lab/departments" element={<AdminDepartmentsPage />} />
          <Route path="/admin/lab/adjustment-reasons" element={<AdminAdjustmentReasonsPage />} />
          <Route path="/admin/users" element={<AdminUsersPage />} />
          <Route path="/admin/users/:userId/pricing" element={<AdminClientPricingPage />} />
          <Route path="/admin/autopay" element={<AdminAutoPayPage />} />
          <Route path="/admin/jobs" element={<AdminJobsPage />} />
          <Route path="/admin/notifications" element={<AdminLabAlertsPage />} />
          <Route path="/admin/rx-mapping" element={<AdminRxMappingPage />} />
          <Route path="/admin/scheduling" element={<AdminSchedulingPage />} />
          <Route path="/admin/labels" element={<AdminLabelsPage />} />
        </Route>
        <Route element={<RequireStaff />}>
          <Route path="/lab" element={<LabBoardPage />} />
          <Route path="/lab/calendar" element={<OrdersCalendarPage />} />
          <Route path="/lab/intake" element={<IntakePage />} />
          <Route path="/lab/orders/new" element={<NewLabOrderPage />} />
          <Route path="/lab/orders/:id" element={<LabOrderDetailPage />} />
          <Route path="/lab/messages" element={<LabMessagesPage />} />
          <Route path="/lab/messages/:id" element={<LabThreadPage />} />
          <Route path="/lab/pickups" element={<LabPickupsPage />} />
          <Route path="/lab/deliveries" element={<DeliveriesPage />} />
          <Route path="/admin/shipments" element={<ShipmentsPage />} />
          <Route path="/admin/rx-cases" element={<AdminRxCasesPage />} />
          <Route path="/admin/rx-cases/:id" element={<AdminRxCaseDetailPage />} />
        </Route>
      </Route>

      {/* Print pages: staff only, no app shell (a 4×6 label; the letter-size route sheet) */}
      <Route element={<RequireStaff />}>
        <Route path="/lab/shipments/:id/print" element={<ShipmentLabelPrintPage />} />
        <Route path="/lab/deliveries/print" element={<DeliveryRoutePrintPage />} />
      </Route>

      {/* Protected doctor routes */}
      <Route path="/doctor" element={<RequireDoctor />}>
        <Route element={<DoctorShell />}>
          <Route path="invoices" element={<InvoicesPage />} />
          <Route path="invoices/:id" element={<InvoiceDetailPage />} />
          <Route path="payments" element={<PaymentsPage />} />
          <Route path="saved-cards" element={<SavedCardsPage />} />
          <Route path="autopay" element={<AutoPayPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="cases" element={<MyCasesPage />} />
          <Route path="messages" element={<MessagesPage />} />
          <Route path="messages/:id" element={<ThreadPage />} />
          <Route path="pickups" element={<PickupsPage />} />
        </Route>
      </Route>

      {/* Doctor case submission (full-page wizard, no AppShell) */}
      <Route element={<RequireDoctor />}>
        <Route path="/app/cases/new" element={<NewCasePage />} />
      </Route>

      {/* Rx forms — chooser + the digital Rx and the orthodontic Rx.
          Accessible to approved doctors AND admins (for testing/oversight). */}
      <Route element={<RequireRxAccess />}>
        <Route path="/app/rx" element={<RxChooserPage />} />
        <Route path="/app/rx/digital" element={<RxFormPage slug="digital" />} />
        <Route path="/app/rx/ortho" element={<RxFormPage slug="ortho" />} />
      </Route>

      {/* Dev-only payment test harness (any authenticated user).
          Excluded from production builds via the DEV guard above. */}
      {import.meta.env.DEV && PaymentTestPage && (
        <Route
          path="/dev/pay-test"
          element={
            <RequireAuth>
              <Suspense fallback={null}>
                <PaymentTestPage />
              </Suspense>
            </RequireAuth>
          }
        />
      )}

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <ToastProvider>
        <AppRoutes />
        <ThemeEditor />
      </ToastProvider>
    </BrowserRouter>
  );
}
