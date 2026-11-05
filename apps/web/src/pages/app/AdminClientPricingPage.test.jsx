// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ToastProvider } from "../../components/ui/Toast.jsx";

const get = vi.fn();
vi.mock("../../config/api.js", () => ({ default: { get: (...a) => get(...a), put: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
const { AdminClientPricingPage, priceDelta, clientLabel } = await import("./AdminClientPricingPage.jsx");

afterEach(() => { cleanup(); get.mockReset(); });

test("the delta against base is shown as a rounded percentage", () => {
  assert.equal(priceDelta(40500, 45000), "−10%");
  assert.equal(priceDelta(47250, 45000), "+5%");
  assert.equal(priceDelta(45000, 45000), "");
  assert.equal(priceDelta(100, null), "");
  assert.equal(priceDelta(0, 2000), "−100%");
});

test("the page names whose prices these are", () => {
  const users = [
    { id: "u1", name: "Dr. Ana Ruiz", email: "ana@clinic.test", account: { name: "Ruiz Dental" } },
    { id: "u2", name: null, email: "nobody@clinic.test", account: null },
  ];
  assert.deepEqual(clientLabel(users, "u1"), { name: "Dr. Ana Ruiz", email: "ana@clinic.test", practice: "Ruiz Dental" });
  assert.deepEqual(clientLabel(users, "u2"), { name: "nobody@clinic.test", email: null, practice: null });
  assert.equal(clientLabel(users, "zz"), null);
});

const ENTRY = { variantName: "Crown", variantCode: "C1", familyName: "Crowns", basePriceCents: 10000 };

function mount({ prices, effective, assigned = [{ listId: "L1", name: "Gold", archivedAt: null, position: 0 }] }) {
  get.mockImplementation(async (path) => {
    const ok = (data) => ({ data: { data } });
    if (path === "/admin/clients/u1/prices") return ok({ prices, effective });
    if (path === "/admin/catalog/families") return ok({ families: [] });
    if (path === "/admin/clients/u1/price-lists") return ok(assigned);
    if (path === "/admin/price-lists") return ok([{ id: "L1", name: "Gold" }]);
    if (path === "/admin/users") return ok({ users: [] });
    throw new Error(`unexpected GET ${path}`);
  });
  render(
    <MemoryRouter initialEntries={["/admin/users/u1/pricing"]}>
      <ToastProvider>
        <Routes><Route path="/admin/users/:userId/pricing" element={<AdminClientPricingPage />} /></Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

test("client pricing shows the List chip with the list name for a list-priced variant", async () => {
  mount({ prices: [], effective: [{ variantId: "v1", ...ENTRY, cents: 9000, source: "list", listId: "L1", listName: "Gold" }] });
  assert.ok(await screen.findByText("List: Gold"));
  assert.ok(screen.getByText("$90.00"));
});

test('an inferred override equal to the list price shows "Same as list"', async () => {
  mount({
    prices: [{ variantId: "v1", variantName: "Crown", variantCode: "C1", basePriceCents: 10000, priceCents: 9000, listPriceCents: 9000, source: "inferred", reviewedAt: "2026-01-01" }],
    effective: [{ variantId: "v1", ...ENTRY, cents: 9000, source: "client", listId: null, listName: null }],
  });
  const row = (await screen.findByText("Crown")).closest("tr");
  assert.ok(within(row).getByText("Same as list"));
  assert.ok(within(row).getByText("Client"));
});

test("loading the page makes no per-list item requests", async () => {
  mount({ prices: [], effective: [] });
  await screen.findByLabelText("Assigned lists");
  assert.ok(!get.mock.calls.some(([path]) => String(path).includes("/items")));
});

test("an archived assigned list is struck through in the strip", async () => {
  mount({ prices: [], effective: [], assigned: [{ listId: "L1", name: "Gold", archivedAt: "2026-02-01", position: 0 }] });
  const strip = await screen.findByLabelText("Assigned lists");
  const name = within(strip).getByText("Gold");
  assert.match(name.className, /line-through/);
});
