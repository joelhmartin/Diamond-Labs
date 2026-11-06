// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../components/ui/Toast.jsx";

const get = vi.fn();
const patch = vi.fn();
vi.mock("../../config/api.js", () => ({ default: { get: (...a) => get(...a), patch: (...a) => patch(...a), post: vi.fn(), delete: vi.fn() } }));
const { PracticeDrawer } = await import("./PracticeDrawer.jsx");

afterEach(() => { cleanup(); get.mockReset(); patch.mockReset(); });

const PRACTICE = { id: "a1", name: "North Dental", accountNumber: "100", organization: null };
const wrap = (ui) => render(<MemoryRouter><ToastProvider>{ui}</ToastProvider></MemoryRouter>);

test("practice drawer role change saves", async () => {
  get.mockResolvedValue({ data: { data: [
    { userId: "o1", name: "Olive Owner", email: "o@x.test", role: "admin", isOwner: true },
    { userId: "u2", name: "Vic Viewer", email: "v@x.test", role: "viewer", isOwner: false },
  ] } });
  patch.mockResolvedValue({ data: { data: { userId: "u2", role: "member" } } });
  wrap(<PracticeDrawer practice={PRACTICE} onClose={() => {}} onChanged={() => {}} />);
  await screen.findByText("Vic Viewer");
  assert.equal(screen.queryByLabelText("Role for Olive Owner"), null, "the owner's role is not editable");
  fireEvent.change(screen.getByLabelText("Role for Vic Viewer"), { target: { value: "member" } });
  await waitFor(() => assert.equal(patch.mock.calls.length, 1));
  assert.deepEqual(patch.mock.calls[0], ["/admin/practices/a1/members/u2", { role: "member" }]);
  await waitFor(() => assert.equal(get.mock.calls.length, 2), { timeout: 2000 });
});

test("a taken account number shows the server's message and does not close the form", async () => {
  get.mockResolvedValue({ data: { data: [] } });
  patch.mockRejectedValue({ response: { data: { error: { code: "ACCOUNT_NUMBER_TAKEN", message: "That account number belongs to another practice." } } } });
  wrap(<PracticeDrawer practice={PRACTICE} onClose={() => {}} onChanged={() => {}} />);
  fireEvent.change(await screen.findByLabelText("Lab account number"), { target: { value: "200" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText(/belongs to another practice/);
});

test("the owner row has no select checkbox, so bulk Remove can never include it", async () => {
  get.mockResolvedValue({ data: { data: [
    { userId: "o1", name: "Olive Owner", email: "o@x.test", role: "admin", isOwner: true },
    { userId: "u2", name: "Vic Viewer", email: "v@x.test", role: "viewer", isOwner: false },
  ] } });
  wrap(<PracticeDrawer practice={PRACTICE} onClose={() => {}} onChanged={() => {}} />);
  await screen.findByText("Vic Viewer");
  const ownerRow = screen.getByText("Olive Owner").closest("tr");
  assert.equal(ownerRow.querySelector('input[type="checkbox"]:not([disabled])'), null);
  assert.ok(screen.getByText("Vic Viewer").closest("tr").querySelector('input[type="checkbox"]:not([disabled])'));
});
