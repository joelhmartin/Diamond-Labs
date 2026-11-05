// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, act, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ToastProvider } from "../../../components/ui/Toast.jsx";
import { ROUTES, dashboardPath } from "../../../config/routes.js";

const listDashboards = vi.fn();
const getDashboard = vi.fn();
vi.mock("../api.js", () => ({
  listDashboards: (...a) => listDashboards(...a),
  getDashboard: (...a) => getDashboard(...a),
}));
vi.mock("../Chart.jsx", () => ({
  Chart: ({ spec, rows }) => <figure data-testid="chart">{`${spec.type}:${rows.length}`}</figure>,
}));
const { DashboardPage } = await import("../DashboardPage.jsx");
const { StatTile } = await import("../StatTile.jsx");
const { FeedTile } = await import("../FeedTile.jsx");

afterEach(() => {
  cleanup();
  listDashboards.mockReset();
  getDashboard.mockReset();
  vi.useRealTimers();
  setVisibility("visible");
});

function setVisibility(state) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

const LIST = { dashboards: [{ key: "pulse", title: "Pulse", params: [] }, { key: "ops", title: "Operations", params: [] }] };
const PULSE = {
  key: "pulse", title: "Pulse",
  tiles: [
    { id: "count", kind: "stat", span: 1, title: "New today", ok: true, data: { value: 7, previous: 5, format: "int" } },
    { id: "boom", kind: "table", span: 2, title: "Broken", ok: false, error: { code: "TIMEOUT", message: "This report took too long. Try a shorter date range." } },
    {
      id: "trend", kind: "chart", span: 2, title: "Trend", ok: true,
      chart: { type: "line", x: "day", series: [{ field: "n", label: "N" }] },
      columns: [{ id: "day", label: "Day", type: "date" }, { id: "n", label: "N", type: "int" }],
      data: { rows: [{ day: "2026-11-01", n: 1 }, { day: "2026-11-02", n: 2 }] },
    },
    {
      id: "list", kind: "table", span: 2, title: "At risk", ok: true,
      columns: [{ id: "name", label: "Name", type: "text" }, { id: "amount", label: "Amount", type: "money" }],
      data: { rows: [{ name: "Acme", amount: 1250 }] },
    },
  ],
};

function mount(url = ROUTES.LAB_DASHBOARD_HOME) {
  listDashboards.mockResolvedValue(LIST);
  getDashboard.mockResolvedValue(PULSE);
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <Routes>
          <Route path={ROUTES.LAB_DASHBOARD_HOME} element={<DashboardPage />} />
          <Route path={ROUTES.LAB_DASHBOARD} element={<DashboardPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

test("DashboardPage renders tabs, a failed tile shows its message, others render", async () => {
  mount();
  assert.ok(await screen.findByText("This report took too long. Try a shorter date range."));
  const tabs = screen.getByRole("navigation", { name: "Dashboards" });
  const links = within(tabs).getAllByRole("link");
  assert.deepEqual(links.map((l) => l.textContent), ["Pulse", "Operations"]);
  assert.equal(links[0].getAttribute("aria-current"), "page");
  assert.ok(links[1].getAttribute("href").endsWith(dashboardPath("ops")));
  // No key in the URL opens the first dashboard.
  assert.equal(getDashboard.mock.calls[0][0], "pulse");
  // The other tiles render.
  assert.ok(screen.getByText("New today"));
  assert.ok(screen.getByText("7"));
  assert.equal(screen.getByTestId("chart").textContent, "line:2");
  assert.ok(screen.getByText("Acme"));
  assert.ok(screen.getByText("$12.50"));
});

test("a dashboard key in the URL loads that dashboard", async () => {
  mount(dashboardPath("ops"));
  await screen.findByText("New today");
  assert.equal(getDashboard.mock.calls[0][0], "ops");
});

test("a dashboard that fails to load says so", async () => {
  listDashboards.mockResolvedValue(LIST);
  getDashboard.mockRejectedValue({ response: { status: 403, data: { error: { message: "You cannot view this report." } } } });
  render(
    <MemoryRouter initialEntries={[dashboardPath("ops")]}>
      <ToastProvider><Routes><Route path={ROUTES.LAB_DASHBOARD} element={<DashboardPage />} /></Routes></ToastProvider>
    </MemoryRouter>,
  );
  assert.ok(await screen.findByText("You cannot view this report."));
});

test("StatTile shows the value and the delta vs previous", () => {
  render(<MemoryRouter><StatTile title="New" value={7} previous={5} format="int" /></MemoryRouter>);
  assert.ok(screen.getByText("7"));
  assert.ok(screen.getByText(/▲\s*40\.0%/));
  cleanup();
  render(<MemoryRouter><StatTile title="Cash" value={900} previous={1200} format="money" /></MemoryRouter>);
  assert.ok(screen.getByText("$9.00"));
  assert.ok(screen.getByText(/▼\s*25\.0%/));
});

test("StatTile has no delta without a usable previous; href makes it a link", () => {
  render(<MemoryRouter><StatTile title="New" value={3} previous={0} format="int" href="/somewhere" /></MemoryRouter>);
  assert.equal(screen.queryByText(/[▲▼]/), null);
  assert.ok(screen.getByRole("link").getAttribute("href").endsWith("/somewhere"));
  cleanup();
  render(<MemoryRouter><StatTile title="New" value={3} previous={null} format="int" /></MemoryRouter>);
  assert.equal(screen.queryByText(/[▲▼]/), null);
  assert.equal(screen.queryByRole("link"), null);
});

test("FeedTile stops polling when hidden", () => {
  vi.useFakeTimers();
  const reload = vi.fn();
  const columns = [{ id: "at", label: "When", type: "datetime" }, { id: "what", label: "What", type: "text" }];
  const rows = [{ at: "2026-11-05T15:00:00.000Z", what: "Moved to shipped" }];
  const { unmount } = render(<FeedTile rows={rows} columns={columns} reload={reload} />);
  assert.ok(screen.getByText("Moved to shipped"));
  act(() => { vi.advanceTimersByTime(30000); });
  assert.equal(reload.mock.calls.length, 1);
  act(() => { setVisibility("hidden"); });
  act(() => { vi.advanceTimersByTime(120000); });
  assert.equal(reload.mock.calls.length, 1);
  // Visible again: refresh at once, then resume the 30 s rhythm.
  act(() => { setVisibility("visible"); });
  assert.equal(reload.mock.calls.length, 2);
  act(() => { vi.advanceTimersByTime(30000); });
  assert.equal(reload.mock.calls.length, 3);
  unmount();
  act(() => { vi.advanceTimersByTime(120000); });
  assert.equal(reload.mock.calls.length, 3);
});

test("the feed tile reloads just its own tile", async () => {
  listDashboards.mockResolvedValue(LIST);
  const feed = {
    id: "feed", kind: "feed", span: 2, title: "Activity", ok: true,
    columns: [{ id: "what", label: "What", type: "text" }],
    data: { rows: [{ what: "First event" }] },
  };
  getDashboard.mockResolvedValueOnce({ ...PULSE, tiles: [feed] });
  getDashboard.mockResolvedValueOnce({ ...PULSE, tiles: [{ ...feed, data: { rows: [{ what: "Newer event" }] } }] });
  vi.useFakeTimers({ shouldAdvanceTime: true });
  render(
    <MemoryRouter initialEntries={[dashboardPath("pulse")]}>
      <ToastProvider><Routes><Route path={ROUTES.LAB_DASHBOARD} element={<DashboardPage />} /></Routes></ToastProvider>
    </MemoryRouter>,
  );
  await screen.findByText("First event");
  act(() => { vi.advanceTimersByTime(30000); });
  await waitFor(() => assert.ok(screen.getByText("Newer event")));
  assert.deepEqual(getDashboard.mock.calls[1], ["pulse", { tile: "feed" }]);
});
