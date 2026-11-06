// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../../config/api.js", () => ({ default: api }));
vi.mock("../../data/forms/index.js", () => ({ getForm: () => ({ title: "Digital Rx" }) }));
vi.mock("../../components/rx/FormRenderer.jsx", () => ({
  FormRenderer: ({ onSubmit }) => <button onClick={() => onSubmit(new FormData())}>SUBMIT RX</button>,
}));

import { RxFormPage } from "./RxFormPage.jsx";
import { useAccountStore } from "../../stores/account.store.js";

afterEach(() => { cleanup(); vi.clearAllMocks(); useAccountStore.getState().clearClientScope(); sessionStorage.clear(); });

const acct = (id, name, over = {}) => ({ id, name, accountNumber: null, organizationId: null, via: "member", role: "admin", payable: true, direct: true, ...over });
const setScope = (accounts, loaded = true) => useAccountStore.setState({ clientScope: { accounts, organizations: [] }, practiceScope: "all", clientScopeLoaded: loaded });
const mount = () => render(<MemoryRouter><RxFormPage slug="digital-rx" /></MemoryRouter>);

test("a doctor who is a direct member of A and B and admin of A's group is asked which practice, and it is sent", async () => {
  // A is direct AND reached through its group (via org-admin); B is direct only.
  setScope([acct("a1", "North", { via: "org-admin" }), acct("a2", "South")]);
  api.post.mockResolvedValue({ data: { data: { id: "c1", caseNumber: "RX-1", status: "new" } } });
  mount();
  const select = screen.getByLabelText("Practice");
  assert.equal(select.querySelectorAll("option").length, 3);
  fireEvent.click(screen.getByText("SUBMIT RX"));
  await screen.findByText("Choose which practice this is for.");
  assert.equal(api.post.mock.calls.length, 0);
  fireEvent.change(select, { target: { value: "a1" } });
  fireEvent.click(screen.getByText("SUBMIT RX"));
  await waitFor(() => assert.equal(api.post.mock.calls.length, 1));
  assert.equal(api.post.mock.calls[0][1].get("accountId"), "a1");
});

test("a group-only practice is not offered, and nothing is sent before the scope has loaded", async () => {
  setScope([acct("a1", "North"), acct("a2", "Sibling", { via: "org-admin", direct: false })], false);
  mount();
  fireEvent.click(screen.getByText("SUBMIT RX"));
  await screen.findByText(/Still loading your practices/);
  assert.equal(api.post.mock.calls.length, 0);
  setScope([acct("a1", "North"), acct("a2", "Sibling", { via: "org-admin", direct: false })], true);
  assert.equal(screen.queryByLabelText("Practice"), null);
});
