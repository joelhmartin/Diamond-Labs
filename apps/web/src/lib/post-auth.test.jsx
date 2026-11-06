// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ToastProvider } from "../components/ui/Toast.jsx";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../config/api.js", () => ({ default: api }));

import { MfaChallenge } from "../components/auth/MfaChallenge.jsx";
import { RequireUserRole } from "../guards/RequireUserRole.jsx";
import { useAccountStore } from "../stores/account.store.js";
import { useAuthStore } from "../stores/auth.store.js";

afterEach(() => { cleanup(); vi.clearAllMocks(); useAccountStore.getState().clearClientScope(); useAuthStore.setState({ user: null, isAuthenticated: false }); sessionStorage.clear(); });

const Where = () => <div data-testid="where">{useLocation().pathname}</div>;
const ACCOUNT = { id: "a1", name: "North", accountNumber: null, organizationId: null, via: "member", role: "admin", payable: true, direct: true };

test("MFA sign-in lands a practice-only login on /doctor/invoices", async () => {
  api.post.mockResolvedValue({ data: { data: { user: { id: "u1", role: "user" }, accessToken: "t" } } });
  api.get.mockResolvedValue({ data: { data: { accounts: [ACCOUNT], organizations: [] } } });
  render(
    <MemoryRouter initialEntries={["/auth/login"]}><ToastProvider><Routes>
      <Route path="/auth/login" element={<MfaChallenge mfaToken="m" />} />
      <Route path="*" element={<Where />} />
    </Routes></ToastProvider></MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText("Authentication Code"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify" }));
  await waitFor(() => assert.equal(screen.getByTestId("where").textContent, "/doctor/invoices"));
});

test("a wrong-area redirect sends a practice-only login to the portal, not the dashboard", async () => {
  useAuthStore.setState({ user: { id: "u1", role: "user" }, isAuthenticated: true, isLoading: false });
  useAccountStore.setState({ clientScope: { accounts: [ACCOUNT], organizations: [] }, clientScopeLoaded: true });
  render(
    <MemoryRouter initialEntries={["/lab"]}><Routes>
      <Route element={<RequireUserRole roles={["lab"]} />}><Route path="/lab" element={<div>LAB</div>} /></Route>
      <Route path="*" element={<Where />} />
    </Routes></MemoryRouter>,
  );
  await waitFor(() => assert.equal(screen.getByTestId("where").textContent, "/doctor/invoices"));
});
