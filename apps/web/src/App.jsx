import { useEffect, useRef } from "react";
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
import { AdminProductsPage } from "./pages/app/AdminProductsPage.jsx";
import { AdminInvoicesPage } from "./pages/app/AdminInvoicesPage.jsx";
import { AdminPaymentsPage } from "./pages/app/AdminPaymentsPage.jsx";
import { AdminUsersPage } from "./pages/app/AdminUsersPage.jsx";
import { AdminOrdersPage } from "./pages/app/AdminOrdersPage.jsx";
import { AdminOrderDetailPage } from "./pages/app/AdminOrderDetailPage.jsx";
import { AdminRxMappingPage } from "./pages/app/AdminRxMappingPage.jsx";
import { RequireAdmin } from "./guards/RequireAdmin.jsx";

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
import { PaymentsPage } from "./pages/doctor/PaymentsPage.jsx";
import { SavedCardsPage } from "./pages/doctor/SavedCardsPage.jsx";
import { NewCasePage } from "./pages/app/NewCasePage.jsx";
import { RxChooserPage } from "./pages/app/RxChooserPage.jsx";
import { RxFormPage } from "./pages/app/RxFormPage.jsx";
import { RequireDoctor } from "./guards/RequireDoctor.jsx";
import { RequireRxAccess } from "./guards/RequireRxAccess.jsx";
import { PaymentTestPage } from "./pages/dev/PaymentTestPage.jsx";
import { ThemeEditor } from "./components/theme/ThemeEditor.jsx";

/* Scroll to top on route change, but NOT on initial load —
   that lets the browser restore scroll position on reload. */
function ScrollToTop() {
  const { pathname } = useLocation();
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    window.scrollTo(0, 0);
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
        <Route element={<RequireAdmin />}>
          <Route path="/admin" element={<Navigate to="/admin/invoices" replace />} />
          <Route path="/admin/products" element={<AdminProductsPage />} />
          <Route path="/admin/invoices" element={<AdminInvoicesPage />} />
          <Route path="/admin/payments" element={<AdminPaymentsPage />} />
          <Route path="/admin/orders" element={<AdminOrdersPage />} />
          <Route path="/admin/orders/:id" element={<AdminOrderDetailPage />} />
          <Route path="/admin/users" element={<AdminUsersPage />} />
          <Route path="/admin/rx-mapping" element={<AdminRxMappingPage />} />
        </Route>
      </Route>

      {/* Protected doctor routes */}
      <Route path="/doctor" element={<RequireDoctor />}>
        <Route element={<DoctorShell />}>
          <Route path="invoices" element={<InvoicesPage />} />
          <Route path="payments" element={<PaymentsPage />} />
          <Route path="saved-cards" element={<SavedCardsPage />} />
        </Route>
      </Route>

      {/* Doctor case submission (full-page wizard, no AppShell) */}
      <Route element={<RequireDoctor />}>
        <Route path="/app/cases/new" element={<NewCasePage />} />
      </Route>

      {/* Faithful 1:1 Rx forms — chooser + three forms.
          Accessible to approved doctors AND admins (for testing/oversight). */}
      <Route element={<RequireRxAccess />}>
        <Route path="/app/rx" element={<RxChooserPage />} />
        <Route path="/app/rx/digital" element={<RxFormPage slug="digital" />} />
        <Route path="/app/rx/ortho" element={<RxFormPage slug="ortho" />} />
        <Route path="/app/rx/olmos" element={<RxFormPage slug="olmos" />} />
      </Route>

      {/* Dev-only payment test harness (any authenticated user) */}
      <Route path="/dev/pay-test" element={<RequireAuth><PaymentTestPage /></RequireAuth>} />

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
