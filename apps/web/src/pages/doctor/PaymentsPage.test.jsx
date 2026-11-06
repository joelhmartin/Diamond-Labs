// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const get = vi.fn();
vi.mock("../../config/api.js", () => ({ default: { get: (...a) => get(...a) } }));
const { PaymentsPage } = await import("./PaymentsPage.jsx");
const { useAccountStore } = await import("../../stores/account.store.js");

afterEach(() => { cleanup(); get.mockReset(); useAccountStore.getState().clearClientScope(); sessionStorage.clear(); });

const pay = (id, accountId) => ({ transactionId: id, accountId, createdAt: "2026-10-01T12:00:00Z", source: "doctor_card", grossCents: 5000, refundedCents: 0, netCents: 5000, status: "paid", invoices: [{ invoiceNumber: "101" }] });
const acct = (id, name, n) => ({ id, name, accountNumber: n, organizationId: null, via: "direct", role: "admin", payable: true });
const setScope = (accounts) => useAccountStore.setState({ clientScope: { accounts, organizations: [] }, practiceScope: "all", clientScopeLoaded: true });
const mount = () => {
  get.mockResolvedValue({ data: { data: { payments: [pay("T1", "a1"), pay("T2", "a2"), pay("T3", null)] } } });
  render(<MemoryRouter><PaymentsPage /></MemoryRouter>);
};

test("PaymentsPage: a login with several practices gets a Practice column naming each payment's practice", async () => {
  setScope([acct("a1", "North Dental", "100"), acct("a2", "South Dental", "200")]);
  mount();
  await screen.findByText(/North Dental/);
  assert.ok(screen.getByRole("columnheader", { name: /Practice/ }));
  assert.ok(screen.getByText(/South Dental/));
});

test("PaymentsPage: a single-practice login keeps the plain table", async () => {
  setScope([acct("a1", "North Dental", "100")]);
  mount();
  await screen.findAllByText("101");
  assert.equal(screen.queryByRole("columnheader", { name: /Practice/ }), null);
});
