// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const get = vi.fn();
vi.mock("../../config/api.js", () => ({ default: { get: (...a) => get(...a) } }));
const { SamePricingTab } = await import("./SamePricingTab.jsx");

afterEach(() => { cleanup(); get.mockReset(); });

const GROUP = {
  signature: "s1", size: 4, lists: ["Gold"], overrideCount: 2,
  clients: ["Ana", "Bo", "Cy", "Di"].map((name, i) => ({ id: `c${i}`, name, accountNumber: `${i}`, practice: null })),
};

test("lists groups with a first-three preview and expands to linked clients", async () => {
  get.mockResolvedValue({ data: { data: { groups: [GROUP] } } });
  render(<MemoryRouter><SamePricingTab /></MemoryRouter>);
  await screen.findByText("Ana, Bo, Cy, +1 more");
  assert.deepEqual(get.mock.calls[0], ["/admin/prices/same-pricing", { params: {} }]);
  fireEvent.click(screen.getByLabelText("Expand row"));
  const link = await screen.findByRole("link", { name: "Di" });
  assert.equal(link.getAttribute("href"), "/admin/users/c3/pricing");
});

test("the singles toggle refetches with includeSingles", async () => {
  get.mockResolvedValue({ data: { data: { groups: [] } } });
  render(<MemoryRouter><SamePricingTab /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Include single clients" }));
  await waitFor(() => assert.deepEqual(get.mock.calls.at(-1), ["/admin/prices/same-pricing", { params: { includeSingles: "1" } }]));
});
