// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("../../config/api.js", () => ({ default: { get: vi.fn() } }));

import { useAccountStore } from "../../stores/account.store.js";
import { AccountSwitcher } from "./AccountSwitcher.jsx";

const acct = (id, name, n) => ({ id, name, accountNumber: n, organizationId: null, via: "member", role: "admin", payable: true });
const setScope = (accounts) => useAccountStore.setState({ clientScope: { accounts, organizations: [] }, practiceScope: "all", clientScopeLoaded: true });
afterEach(() => { cleanup(); useAccountStore.getState().clearClientScope(); sessionStorage.clear(); });

test("switcher hidden with one practice", () => {
  setScope([acct("a1", "North Dental", "1001")]);
  const { container } = render(<AccountSwitcher variant="practice" />);
  assert.equal(container.innerHTML, "");
});

test("switcher with several practices offers All practices and each practice", () => {
  setScope([acct("a1", "North Dental", "1001"), acct("a2", "South Dental", "1002")]);
  render(<AccountSwitcher variant="practice" />);
  fireEvent.click(screen.getByRole("button", { name: "Practice" }));
  assert.ok(screen.getByRole("button", { name: "All practices" }));
  fireEvent.click(screen.getByRole("button", { name: "South Dental (1002)" }));
  assert.equal(useAccountStore.getState().practiceScope, "a2");
});
