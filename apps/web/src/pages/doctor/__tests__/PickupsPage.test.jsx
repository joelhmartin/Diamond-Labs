// @vitest-environment jsdom
import { test, afterEach, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../../components/ui/Toast.jsx";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../../../config/api.js", () => ({ default: api }));

import { PickupsPage } from "../PickupsPage.jsx";

const row = (id, number, status, over = {}) => ({
  id, pickupNumber: number, status, earliestDate: "2026-11-06", latestDate: "2026-11-08", timePreference: "am",
  boxCount: 2, scheduledDate: status === "scheduled" ? "2026-11-07" : null, address: null, version: 1, createdAt: `2026-11-0${number}T10:00:00Z`, ...over,
});
const ROWS = [row("a", 1, "requested"), row("b", 2, "scheduled"), row("c", 3, "completed"), row("d", 4, "cancelled")];

beforeEach(() => {
  api.get.mockResolvedValue({ data: { data: { rows: ROWS, total: 4 } } });
  api.post.mockResolvedValue({ data: { data: { id: "a", status: "cancelled", version: 2 } } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const mount = (url = "/doctor/pickups") => render(<MemoryRouter initialEntries={[url]}><ToastProvider><PickupsPage /></ToastProvider></MemoryRouter>);
const byUrl = (map) => api.get.mockImplementation(async (url) => {
  if (url in map) {
    const v = map[url];
    if (v instanceof Error) throw v;
    return { data: { data: v } };
  }
  return { data: { data: { rows: ROWS, total: 4 } } };
});

test("lists practice pickups in a DataTable", async () => {
  mount();
  await screen.findByText("#1");
  assert.equal(api.get.mock.calls[0][0], "/pickups");
  assert.ok(screen.getByText("#4"));
  assert.equal(screen.getAllByText("11/06/2026 – 11/08/2026").length, 4);
  assert.equal(screen.getAllByText("Scheduled").length >= 1, true);
  assert.ok(screen.getByRole("button", { name: "Request a pickup" }));
});

test("Cancel is a ConfirmButton and only on requested/scheduled rows", async () => {
  mount();
  await screen.findByText("#1");
  const cancels = screen.getAllByRole("button", { name: "Cancel" });
  assert.equal(cancels.length, 2);
  fireEvent.click(cancels[0]);
  assert.equal(api.post.mock.calls.length, 0);
  fireEvent.click(screen.getByRole("button", { name: "Click again to cancel" }));
  await waitFor(() => assert.equal(api.post.mock.calls.length, 1));
  assert.deepEqual(api.post.mock.calls[0], ["/pickups/a/cancel", { expectedVersion: 1 }]);
});

test("?pickup=<id> reads that pickup by id, shows it above the list and highlights its row", async () => {
  byUrl({ "/pickups/b": row("b", 2, "scheduled") });
  mount("/doctor/pickups?pickup=b");
  const notice = await screen.findByRole("status", { name: "Linked pickup" });
  assert.match(notice.textContent, /Pickup #2/);
  assert.match(notice.textContent, /Scheduled/);
  assert.match(notice.textContent, /11\/07\/2026/);
  await screen.findByText("#1");
  const current = screen.getAllByRole("row").filter((tr) => tr.getAttribute("aria-current") === "true");
  assert.equal(current.length, 1);
  assert.match(current[0].textContent, /#2/);
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  await waitFor(() => assert.equal(screen.queryByRole("status", { name: "Linked pickup" }), null));
});

test("?pickup=<id> that is not the practice's is toasted as not found", async () => {
  byUrl({ "/pickups/zz": Object.assign(new Error("nf"), { response: { status: 404 } }) });
  mount("/doctor/pickups?pickup=zz");
  await screen.findByText("That pickup was not found.");
  assert.equal(screen.queryByRole("status", { name: "Linked pickup" }), null);
});

const acct = (id, name, n) => ({ id, name, accountNumber: n, organizationId: null, via: "member", role: "admin", payable: true });
const withScope = async (accounts, scope = "all") => {
  const { useAccountStore } = await import("../../../stores/account.store.js");
  useAccountStore.setState({ clientScope: { accounts, organizations: [] }, practiceScope: scope, clientScopeLoaded: true });
  return useAccountStore;
};

test("new pickup in All practices asks for a practice", async () => {
  const store = await withScope([acct("a1", "North Dental", "1001"), acct("a2", "South Dental", "1002")]);
  mount();
  await screen.findByText("#1");
  fireEvent.click(screen.getByRole("button", { name: "Request a pickup" }));
  const select = within((await screen.findByRole("heading", { name: "Request a pickup" })).parentElement).getByLabelText("Practice");
  fireEvent.click(screen.getByRole("button", { name: "Request pickup" }));
  await screen.findByText("Choose which practice this is for.");
  assert.equal(api.post.mock.calls.length, 0);
  fireEvent.change(select, { target: { value: "a2" } });
  api.post.mockResolvedValue({ data: { data: { id: "z", pickupNumber: 9 } } });
  fireEvent.click(screen.getByRole("button", { name: "Request pickup" }));
  await waitFor(() => assert.equal(api.post.mock.calls.length, 1));
  assert.equal(api.post.mock.calls[0][0], "/pickups");
  assert.equal(api.post.mock.calls[0][1].accountId, "a2");
  store.getState().clearClientScope();
});

test("with one practice in view the list asks for it and a new pickup starts on it", async () => {
  const store = await withScope([acct("a1", "North Dental", "1001"), acct("a2", "South Dental", "1002")], "a1");
  mount();
  await screen.findByText("#1");
  assert.deepEqual(api.get.mock.calls[0][1].params.account, "a1");
  fireEvent.click(screen.getByRole("button", { name: "Request a pickup" }));
  const select = within((await screen.findByRole("heading", { name: "Request a pickup" })).parentElement).getByLabelText("Practice");
  assert.equal(select.value, "a1");
  store.getState().clearClientScope();
  sessionStorage.clear();
});
