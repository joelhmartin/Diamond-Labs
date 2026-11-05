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

test("switching tabs clears the previous dashboard's tiles while the next one loads", async () => {
  listDashboards.mockResolvedValue(LIST);
  let release;
  getDashboard.mockResolvedValueOnce(PULSE);
  getDashboard.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
  render(
    <MemoryRouter initialEntries={[dashboardPath("pulse")]}>
      <ToastProvider>
        <Routes><Route path={ROUTES.LAB_DASHBOARD} element={<DashboardPage />} /></Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
  await screen.findByText("New today");
  const tabs = screen.getByRole("navigation", { name: "Dashboards" });
  act(() => { within(tabs).getByText("Operations").click(); });
  const ops = { key: "ops", title: "Operations", tiles: [{ id: "x", kind: "stat", span: 1, title: "Due today", ok: true, data: { value: 2, format: "int" } }] };
  try {
    // While Operations loads, the old tiles are gone and the page says it is loading (not Pulse's tiles under the Operations tab).
    // Booleans only: an AssertionError that prints a DOM node makes node's inspect walk React's fiber graph and hang the worker.
    assert.equal(screen.queryByText("New today") === null, true, "the previous dashboard's tiles are still shown");
    assert.equal(screen.queryByText(/Loading/) !== null, true, "no loading state");
  } finally {
    await act(async () => { release(ops); }); // always settle the request, pass or fail
  }
  assert.ok(await screen.findByText("Due today"));
  assert.equal(getDashboard.mock.calls[1][0], "ops");
});

test("StatTile shows detail counts under the value when present", async () => {
  render(<MemoryRouter><StatTile title="Active clients" value={158} format="int" detail={[{ id: "declining", label: "declining", value: 35 }, { id: "inactive", label: "inactive", value: 111 }]} /></MemoryRouter>);
  assert.ok(screen.getByText("158"));
  assert.ok(screen.getByText("35 declining · 111 inactive"));
  cleanup();
  // A stat tile on a dashboard passes its data's detail through.
  listDashboards.mockResolvedValue(LIST);
  getDashboard.mockResolvedValue({ key: "pulse", title: "Pulse", tiles: [{ id: "a", kind: "stat", span: 1, title: "Month to date", ok: true, data: { value: 1500, format: "money", detail: [{ id: "invoices", label: "invoices", value: 3 }] } }] });
  render(
    <MemoryRouter initialEntries={[dashboardPath("pulse")]}>
      <ToastProvider><Routes><Route path={ROUTES.LAB_DASHBOARD} element={<DashboardPage />} /></Routes></ToastProvider>
    </MemoryRouter>,
  );
  assert.ok(await screen.findByText("3 invoices"));
});

test("FeedTile links a row that carries an href", () => {
  const columns = [{ id: "at", label: "When", type: "datetime" }, { id: "text", label: "What", type: "text" }];
  const rows = [{ at: "2026-11-05T15:00:00.000Z", text: "Moved to production", href: "/somewhere/12" }, { at: "2026-11-05T14:00:00.000Z", text: "No link here" }];
  render(<MemoryRouter><FeedTile rows={rows} columns={columns} /></MemoryRouter>);
  const link = screen.getByRole("link", { name: "Moved to production" });
  assert.ok(link.getAttribute("href").endsWith("/somewhere/12"));
  assert.equal(screen.getAllByRole("link").length, 1);
  assert.ok(screen.getByText("No link here"));
});
