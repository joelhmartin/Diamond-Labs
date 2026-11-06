// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, within, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../../components/ui/Toast.jsx";

const listReports = vi.fn();
const setFavorite = vi.fn();
vi.mock("../api.js", () => ({
  listReports: (...a) => listReports(...a),
  setFavorite: (...a) => setFavorite(...a),
}));
const { ReportsIndexPage, buildSections } = await import("../ReportsIndexPage.jsx");

afterEach(() => { cleanup(); listReports.mockReset(); setFavorite.mockReset(); });

const report = (over) => ({
  group: "sales", featured: false, favorite: false, available: true, missing: [],
  params: [], columns: [], paging: "client", ...over,
});
const DATA = {
  groups: [{ key: "sales", title: "Sales", position: 1 }, { key: "accounts", title: "Accounts", position: 2 }],
  reports: [
    report({ key: "sales.daily", title: "Daily totals", description: "Totals per calendar day" }),
    report({ key: "accounts.aging", group: "accounts", title: "Aging", description: "Open balances in age buckets", favorite: true }),
    report({ key: "sales.top", title: "Top sellers", description: "Best items", featured: true }),
    report({ key: "accounts.pickups", group: "accounts", title: "Pickups", description: "Collected items", available: false, missing: ["pickups"] }),
  ],
};

function mount() {
  listReports.mockResolvedValue(DATA);
  return render(<MemoryRouter><ToastProvider><ReportsIndexPage /></ToastProvider></MemoryRouter>);
}

const sections = () => screen.getAllByRole("region");
const sectionTitles = () => sections().map((s) => within(s).getByRole("heading").textContent);

test("the featured section uses the server's featuredTitle", async () => {
  listReports.mockResolvedValue({ ...DATA, featuredTitle: "Team picks" });
  render(<MemoryRouter><ToastProvider><ReportsIndexPage /></ToastProvider></MemoryRouter>);
  await screen.findAllByText("Daily totals");
  assert.deepEqual(sectionTitles(), ["Favorites", "Team picks", "Sales", "Accounts"]);
});

test("search filters by title and description", async () => {
  mount();
  await screen.findAllByText("Daily totals");
  fireEvent.change(screen.getByRole("searchbox", { name: /search reports/i }), { target: { value: "age buckets" } });
  assert.equal(screen.queryByText("Daily totals"), null);
  assert.ok(screen.getAllByText("Aging").length >= 1);
  fireEvent.change(screen.getByRole("searchbox", { name: /search reports/i }), { target: { value: "daily" } });
  assert.ok(screen.getByText("Daily totals"));
  assert.equal(screen.queryByText("Aging"), null);
  fireEvent.change(screen.getByRole("searchbox", { name: /search reports/i }), { target: { value: "nothing like this" } });
  assert.ok(screen.getByText(/No reports match/));
});

test("favorites section shows starred reports first", async () => {
  mount();
  await screen.findAllByText("Daily totals");
  assert.deepEqual(sectionTitles(), ["Favorites", "Featured", "Sales", "Accounts"]);
  assert.ok(within(sections()[0]).getByText("Aging"));
  assert.ok(within(sections()[1]).getByText("Top sellers"));
});

test("starring is optimistic and reverts with a toast on error", async () => {
  setFavorite.mockRejectedValueOnce({ response: { data: { error: { message: "Could not save" } } } });
  mount();
  await screen.findAllByText("Daily totals");
  const star = within(sections().find((s) => within(s).queryByText("Daily totals"))).getByRole("button", { name: "Star Daily totals" });
  fireEvent.click(star);
  // Optimistic: it moved into Favorites at once.
  assert.ok(within(sections()[0]).getByText("Daily totals"));
  assert.deepEqual(setFavorite.mock.calls[0], ["sales.daily", true]);
  assert.ok(await screen.findByText("Could not save"));
  await waitFor(() => assert.equal(within(sections()[0]).queryByText("Daily totals"), null));
});

test('unavailable report shows "Not available yet" and is not a link', async () => {
  mount();
  await screen.findByText("Pickups");
  assert.equal(screen.queryByRole("link", { name: /Pickups/ }), null);
  assert.ok(screen.getByText(/Not available yet/));
  assert.ok(screen.getByRole("link", { name: "Daily totals" }).getAttribute("href").endsWith("/reports/sales.daily"));
});

test("an unlisted report (a dashboard tile's source) is not in the index sections", () => {
  const groups = [{ key: "sales", title: "Sales", position: 1 }];
  const reports = [
    report({ key: "sales.daily", title: "Daily totals", featured: true }),
    report({ key: "sales.tile", title: "Tile source", unlisted: true, featured: true }),
  ];
  const sections = buildSections(groups, reports);
  for (const s of sections) assert.ok(!s.items.some((r) => r.key === "sales.tile"), s.key);
  assert.deepEqual(sections.map((s) => s.items.length), [1, 1]);
});
