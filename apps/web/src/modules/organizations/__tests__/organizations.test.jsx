// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../../components/ui/Toast.jsx";
import { ROW_BOX } from "../../../components/ui/data-table/testing.js";

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
const del = vi.fn();
vi.mock("../../../config/api.js", () => ({ default: { get: (...a) => get(...a), post: (...a) => post(...a), patch: (...a) => patch(...a), delete: (...a) => del(...a) } }));
const { OrganizationsTable } = await import("../OrganizationsTable.jsx");
const { AccountsTab } = await import("../AccountsTab.jsx");
const { AdminsTab } = await import("../AdminsTab.jsx");

afterEach(() => { cleanup(); [get, post, patch, del].forEach((m) => m.mockReset()); });

const wrap = (ui) => render(<MemoryRouter><ToastProvider>{ui}</ToastProvider></MemoryRouter>);

test("groups table bulk archive asks inline confirm", async () => {
  get.mockResolvedValue({ data: { data: { rows: [
    { id: "g1", name: "North Group", accountCount: 2, adminCount: 1 },
    { id: "g2", name: "South Group", accountCount: 0, adminCount: 0 },
  ], total: 2 } } });
  patch.mockResolvedValue({ data: { data: {} } });
  wrap(<OrganizationsTable onOpen={() => {}} />);
  await screen.findByText("North Group");
  screen.getAllByLabelText(ROW_BOX).forEach((b) => fireEvent.click(b));
  fireEvent.click(await screen.findByRole("button", { name: "Archive" }));
  assert.equal(patch.mock.calls.length, 0, "the first click only arms it");
  fireEvent.click(screen.getByRole("button", { name: "Click again to archive" }));
  await waitFor(() => assert.equal(patch.mock.calls.length, 2));
  assert.deepEqual(patch.mock.calls.map((c) => [c[0], c[1]]), [["/admin/organizations/g1", { status: "archived" }], ["/admin/organizations/g2", { status: "archived" }]]);
  assert.equal(get.mock.calls[0][1].params.status, "active");
});

test("add accounts picker asks the source for ungrouped accounts and shows exactly what it returns", async () => {
  const list = vi.fn().mockResolvedValue({
    total: 2,
    rows: [
      { id: "a1", label: "Free One", detail: "Acct 1", organizationId: null },
      { id: "a3", label: "Free Two", detail: "Acct 3", organizationId: null },
    ],
  });
  post.mockResolvedValue({ data: { data: { added: ["a1"], alreadyInOther: [] } } });
  wrap(<AccountsTab organizationId="g1" accounts={[{ id: "a0", label: "Already Here" }]} accountsSource={{ list }} onChanged={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: /Add accounts/ }));
  await screen.findByText("Free One");
  assert.ok(screen.getByText("Free Two"), "no filtering after paging: the page is the source's");
  assert.equal(list.mock.calls[0][0].ungrouped, true, "the source is asked for ungrouped accounts only");
  const dialog = screen.getByText("Free One").closest(".relative");
  fireEvent.click(within(dialog).getAllByLabelText(ROW_BOX)[0]);
  fireEvent.click(await screen.findByRole("button", { name: "Add" }));
  await waitFor(() => assert.equal(post.mock.calls.length, 1));
  assert.deepEqual(post.mock.calls[0], ["/admin/organizations/g1/accounts", { accountIds: ["a1"] }]);
});

test("admins tab remove uses ConfirmButton", async () => {
  del.mockResolvedValue({ data: { data: {} } });
  const usersSource = { list: vi.fn(), labels: vi.fn().mockResolvedValue({ u1: "Dana Admin" }) };
  wrap(<AdminsTab organizationId="g1" admins={[{ userId: "u1", status: "active" }, { userId: "u2", status: "removed" }]} usersSource={usersSource} onChanged={() => {}} />);
  await screen.findByText("Dana Admin");
  assert.equal(screen.queryByText("u2"), null, "removed admins are not listed");
  fireEvent.click(screen.getByLabelText(ROW_BOX));
  fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
  assert.equal(del.mock.calls.length, 0);
  fireEvent.click(screen.getByRole("button", { name: "Click again to remove" }));
  await waitFor(() => assert.equal(del.mock.calls.length, 1));
  assert.equal(del.mock.calls[0][0], "/admin/organizations/g1/admins/u1");
});

test("add admins picker sends the people already chosen to the source (server-side exclusion, no short pages)", async () => {
  const list = vi.fn().mockResolvedValue({ total: 1, rows: [{ id: "u9", label: "New Person", detail: null }] });
  wrap(<AdminsTab organizationId="g1" admins={[{ userId: "u1", status: "active" }, { userId: "u2", status: "removed" }]} usersSource={{ list, labels: vi.fn().mockResolvedValue({}) }} onChanged={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: /Add admin/ }));
  await screen.findByText("New Person");
  assert.deepEqual(list.mock.calls[0][0].excludeIds, ["u1"]);
  assert.equal(list.mock.calls[0][0].limit, 10);
});
