// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../components/ui/Toast.jsx";
import { ROW_BOX } from "../../components/ui/data-table/testing.js";

const get = vi.fn();
const post = vi.fn();
vi.mock("../../config/api.js", () => ({ default: { get: (...a) => get(...a), post: (...a) => post(...a), put: vi.fn() } }));
vi.mock("../../hooks/useAuth.js", () => ({ useAuth: () => ({ user: { id: "me" } }) }));
let drawerProps = null;
vi.mock("../../components/admin/DoctorPaymentDrawer.jsx", () => ({ DoctorPaymentDrawer: (p) => { drawerProps = p; return <div>PAYMENT DRAWER</div>; } }));
const { AdminUsersPage } = await import("./AdminUsersPage.jsx");

afterEach(() => { cleanup(); get.mockReset(); post.mockReset(); drawerProps = null; });

const USERS = [
  { id: "u1", email: "a@x.com", name: "Alice", role: "doctor", hasPassword: true, account: { name: "Smile Co" }, seazonaClientId: "s1" },
  { id: "u2", email: "b@x.com", name: "Bob", role: "user", hasPassword: false },
  { id: "u3", email: "c@x.com", name: "Cara", role: "doctor", hasPassword: false },
];

function mount() {
  get.mockResolvedValue({ data: { data: { users: USERS, summary: null } } });
  render(
    <MemoryRouter>
      <ToastProvider><AdminUsersPage /></ToastProvider>
    </MemoryRouter>,
  );
}

test('AdminUsersPage bulk "Send invitations" posts the selected user ids to /admin/users/bulk-email', async () => {
  post.mockResolvedValue({ data: { data: { sent: 2, requested: 2 } } });
  mount();
  await screen.findByText("Alice");
  const boxes = screen.getAllByLabelText(ROW_BOX);
  fireEvent.click(boxes[0]);
  fireEvent.click(boxes[2]);
  fireEvent.click(await screen.findByRole("button", { name: "Send invitations" }));
  fireEvent.click(await screen.findByRole("button", { name: "Click again to send 2 invitations" }));
  await waitFor(() => assert.equal(post.mock.calls.length, 1));
  const [path, body] = post.mock.calls[0];
  assert.equal(path, "/admin/users/bulk-email");
  assert.deepEqual([...body.userIds].sort(), ["u1", "u3"]);
  assert.equal(body.kind, "invitation");
});

test("AdminUsersPage bulk send names the count and warns when fewer were sent than requested", async () => {
  post.mockResolvedValue({ data: { data: { sent: 1, requested: 3 } } });
  mount();
  await screen.findByText("Alice");
  for (const box of screen.getAllByLabelText(ROW_BOX)) fireEvent.click(box);
  fireEvent.click(await screen.findByRole("button", { name: "Send password resets" }));
  fireEvent.click(await screen.findByRole("button", { name: "Click again to send 3 password resets" }));
  const toast = await screen.findByText("Sent 1/3 password resets");
  assert.match(toast.closest("[class*='bg-amber-500']")?.className ?? "", /bg-amber-500/);
});

test("AdminUsersPage passwordless-only filter narrows the list", async () => {
  mount();
  await screen.findByText("Alice");
  fireEvent.click(screen.getByRole("button", { name: "No password" }));
  await waitFor(() => assert.equal(screen.queryByText("Alice"), null));
  assert.ok(screen.getByText("Bob"));
});

test("Users bulk Assign price list posts clientUserIds and toasts ok/failed", async () => {
  get.mockImplementation(async (path) => {
    if (path === "/admin/price-lists") return { data: { data: [{ id: "L1", name: "Gold" }] } };
    return { data: { data: { users: USERS, summary: null } } };
  });
  post.mockResolvedValue({ data: { data: { ok: 1, failed: [{ id: "u2", message: "Not a client" }] } } });
  render(
    <MemoryRouter>
      <ToastProvider><AdminUsersPage /></ToastProvider>
    </MemoryRouter>,
  );
  await screen.findByText("Alice");
  const boxes = screen.getAllByLabelText(ROW_BOX);
  fireEvent.click(boxes[0]);
  fireEvent.click(boxes[1]);
  fireEvent.click(await screen.findByRole("button", { name: "Assign price list…" }));
  fireEvent.change(await screen.findByLabelText("Price list"), { target: { value: "L1" } });
  fireEvent.click(await screen.findByRole("button", { name: "Assign to 2 users" }));
  fireEvent.click(await screen.findByRole("button", { name: "Click again to assign to 2 clients" }));
  await waitFor(() => assert.equal(post.mock.calls.length, 1));
  const [path, body] = post.mock.calls[0];
  assert.equal(path, "/admin/price-lists/assign");
  assert.deepEqual({ ...body, clientUserIds: [...body.clientUserIds].sort() }, { listId: "L1", mode: "add", clientUserIds: ["u1", "u2"] });
  assert.ok(await screen.findByText("1 done, 1 failed: u2 Not a client"));
});

test('AdminUsersPage "Record payment": only for a plain login that runs a practice, and it opens the record-only drawer', async () => {
  const users = [
    { id: "u1", email: "a@x.com", name: "Alice", role: "doctor", hasPassword: true },
    { id: "u2", email: "b@x.com", name: "Bob", role: "user", hasPassword: true, runsPractice: true },
    { id: "u3", email: "c@x.com", name: "Cara", role: "user", hasPassword: true, runsPractice: false },
  ];
  get.mockResolvedValue({ data: { data: { users, summary: null } } });
  render(<MemoryRouter><ToastProvider><AdminUsersPage /></ToastProvider></MemoryRouter>);
  await screen.findByText("Bob");
  const buttons = screen.getAllByRole("button", { name: /Record payment/ });
  assert.equal(buttons.length, 1, "not for the doctor, not for a login that runs no practice");
  fireEvent.click(buttons[0]);
  await screen.findByText("PAYMENT DRAWER");
  assert.equal(drawerProps.recordOnly, true);
  assert.equal(drawerProps.doctor.userId, "u2");
  assert.equal(screen.getAllByRole("button", { name: /Payments/ }).length, 1, "the doctor keeps the full Payments drawer");
});
