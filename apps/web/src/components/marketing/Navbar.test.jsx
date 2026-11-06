// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ROUTES } from "../../config/routes.js";

let authUser = null;
vi.mock("../../hooks/useAuth.js", () => ({ useAuth: () => ({ user: authUser, isAuthenticated: Boolean(authUser), logout: vi.fn() }) }));
vi.mock("gsap", () => ({ default: { to: vi.fn(), set: vi.fn(), fromTo: vi.fn(), killTweensOf: vi.fn() } }));
vi.mock("../marketing/CartWidget.jsx", () => ({ CartWidget: () => null, default: () => null }));
const { Navbar } = await import("./Navbar.jsx");
const { useAccountStore } = await import("../../stores/account.store.js");

afterEach(() => { cleanup(); authUser = null; useAccountStore.getState().clearClientScope(); sessionStorage.clear(); });

function dashboardHref() {
  render(<MemoryRouter><Navbar /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: /Pat/ }));
  return screen.getByRole("link", { name: /Dashboard/ }).getAttribute("href");
}

test("Navbar: a practice-only login's account link goes to the portal, the same landing rule as sign-in", () => {
  authUser = { id: "u1", name: "Pat Staff", role: "user" };
  useAccountStore.setState({ clientScope: { accounts: [{ id: "a1", name: "North", payable: true }], organizations: [] }, clientScopeLoaded: true });
  assert.equal(dashboardHref(), ROUTES.DOCTOR_INVOICES);
});

test("Navbar: a plain user with no practices keeps the generic home", () => {
  authUser = { id: "u1", name: "Pat Staff", role: "user" };
  useAccountStore.setState({ clientScope: { accounts: [], organizations: [] }, clientScopeLoaded: true });
  assert.notEqual(dashboardHref(), ROUTES.DOCTOR_INVOICES);
});
