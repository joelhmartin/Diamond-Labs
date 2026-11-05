// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ToastProvider } from "../../components/ui/Toast.jsx";

const get = vi.fn();
const post = vi.fn();
vi.mock("../../config/api.js", () => ({ default: { get: (...a) => get(...a), post: (...a) => post(...a), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
const { AdminPriceListEditorPage } = await import("./AdminPriceListEditorPage.jsx");

afterEach(() => { cleanup(); get.mockReset(); post.mockReset(); });

const ITEMS = [
  { variantId: "v1", code: "C1", name: "Crown", active: true, basePriceCents: 10000, familyName: "Crowns", listPriceCents: 9000 },
  { variantId: "v2", code: "B1", name: "Bridge", active: true, basePriceCents: 20000, familyName: "Bridges", listPriceCents: null },
];

function mount() {
  get.mockImplementation(async (path) => {
    if (path === "/admin/price-lists") return { data: { data: [{ id: "L1", name: "Gold", description: null, archivedAt: null, itemCount: 1, clientCount: 2, updatedAt: "2026-01-01" }] } };
    if (path === "/admin/price-lists/L1/items") return { data: { data: ITEMS } };
    if (path === "/admin/price-lists/L1/clients") {
      return { data: { data: [{ id: "c1", name: "Ana Ruiz", email: "ana@x.test", practice: "Ruiz Dental", accountNumber: "10", position: 0, assignedAt: "t" }] } };
    }
    throw new Error(`unexpected GET ${path}`);
  });
  post.mockResolvedValue({ data: { data: { count: 2 } } });
  render(
    <MemoryRouter initialEntries={["/admin/price-lists/L1"]}>
      <ToastProvider>
        <Routes><Route path="/admin/price-lists/:id" element={<AdminPriceListEditorPage />} /></Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

test('editor "Set to base price" sends one bulk call with the selected variants', async () => {
  mount();
  await screen.findByText("Crown");
  for (const box of screen.getAllByLabelText("Select row")) fireEvent.click(box);
  fireEvent.click(await screen.findByRole("button", { name: "Set to base price" }));
  fireEvent.click(await screen.findByRole("button", { name: "Click again to set 2 to base" }));
  await waitFor(() => assert.equal(post.mock.calls.length, 1));
  const [path, body] = post.mock.calls[0];
  assert.equal(path, "/admin/price-lists/L1/items/bulk");
  assert.deepEqual(body.items, [
    { variantId: "v1", priceCents: 10000 },
    { variantId: "v2", priceCents: 20000 },
  ]);
});

test("adjust by percent shows a preview and sends rounded prices", async () => {
  mount();
  await screen.findByText("Crown");
  fireEvent.click(screen.getAllByLabelText("Select row")[0]);
  fireEvent.change(await screen.findByLabelText("Adjust by percent"), { target: { value: "-10" } });
  assert.ok(await screen.findByText("$90.00 → $81.00"));
  fireEvent.click(screen.getByRole("button", { name: "Adjust 1 by -10%" }));
  fireEvent.click(await screen.findByRole("button", { name: "Click again to adjust 1 by -10%" }));
  await waitFor(() => assert.equal(post.mock.calls.length, 1));
  assert.deepEqual(post.mock.calls[0][1].items, [{ variantId: "v1", priceCents: 8100 }]);
});

test("the Clients on this list tab shows the assigned clients", async () => {
  mount();
  await screen.findByText("Crown");
  fireEvent.click(screen.getByRole("tab", { name: "Clients on this list" }));
  assert.ok(await screen.findByText("Ana Ruiz"));
  assert.ok(screen.getByText("Ruiz Dental"));
});
