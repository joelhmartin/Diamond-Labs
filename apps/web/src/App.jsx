import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { ToastProvider } from "./components/ui/Toast.jsx";
import { useAuthStore } from "./stores/auth.store.js";
import { useAccountStore } from "./stores/account.store.js";
import { RequireAuth } from "./guards/RequireAuth.jsx";
import { RequireAccount } from "./guards/RequireAccount.jsx";
import { AppShell } from "./components/layout/AppShell.jsx";
import { ROUTES } from "./config/routes.js";

// Auth pages
import { LoginPage } from "./pages/auth/LoginPage.jsx";
import { RegisterPage } from "./pages/auth/RegisterPage.jsx";
import { ForgotPasswordPage } from "./pages/auth/ForgotPasswordPage.jsx";
import { ResetPasswordPage } from "./pages/auth/ResetPasswordPage.jsx";
import { VerifyEmailPage } from "./pages/auth/VerifyEmailPage.jsx";
import { MagicLinkPage } from "./pages/auth/MagicLinkPage.jsx";
import { AcceptInvitePage } from "./pages/auth/AcceptInvitePage.jsx";
import { DoctorRegisterPage } from "./pages/auth/DoctorRegisterPage.jsx";
import { DoctorPendingPage } from "./pages/auth/DoctorPendingPage.jsx";

// App pages
import { DashboardPage } from "./pages/app/DashboardPage.jsx";
import { SettingsPage } from "./pages/app/SettingsPage.jsx";
import { MembersPage } from "./pages/app/MembersPage.jsx";
import { AdminProductsPage } from "./pages/app/AdminProductsPage.jsx";
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
import { SavedCardsPage } from "./pages/doctor/SavedCardsPage.jsx";
import { RequireDoctor } from "./guards/RequireDoctor.jsx";

/* Marketing layout: Navbar + page + Footer + floating cart */
function MarketingLayout() {
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
      <Route path="/auth/magic-link" element={<MagicLinkPage />} />
      <Route path="/auth/accept-invite" element={<AcceptInvitePage />} />

      {/* OAuth callback */}
      <Route path="/auth/oauth-callback" element={<OAuthCallback />} />

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
          <Route path="/admin" element={<Navigate to="/admin/products" replace />} />
          <Route path="/admin/products" element={<AdminProductsPage />} />
        </Route>
      </Route>

      {/* Protected doctor routes */}
      <Route path="/doctor" element={<RequireDoctor />}>
        <Route path="invoices" element={<InvoicesPage />} />
        <Route path="saved-cards" element={<SavedCardsPage />} />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function OAuthCallback() {
  const setAccessToken = useAuthStore((s) => s.setAccessToken);
  const refresh = useAuthStore((s) => s.refresh);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (token) {
      setAccessToken(token);
      // refresh() repopulates user from /auth/me, after which the landing
      // page can redirect via roleHome(). Simplest: send back to dashboard
      // and let RequireAuth + the app shell route them forward if admin.
      refresh();
    }
    window.location.href = ROUTES.DASHBOARD;
  }, []);

  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AppRoutes />
      </ToastProvider>
    </BrowserRouter>
  );
}
