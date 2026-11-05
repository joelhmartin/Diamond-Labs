// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { ToastProvider } from "../../../components/ui/Toast.jsx";

const listReports = vi.fn();
const runReport = vi.fn();
const downloadReportCsv = vi.fn();
vi.mock("../api.js", () => ({
  listReports: (...a) => listReports(...a),
  runReport: (...a) => runReport(...a),
  downloadReportCsv: (...a) => downloadReportCsv(...a),
  setFavorite: vi.fn(async () => ({})),
  searchLookup: vi.fn(async () => []),
  lookupLabel: vi.fn(async () => null),
}));
// The real Chart lazy-loads chart.js onto a canvas; jsdom has none. The config is tested in chart-spec.test.js.
vi.mock("../Chart.jsx", () => ({
  Chart: ({ spec, rows }) => <figure data-testid="chart">{`${spec.type}:${rows.length}`}</figure>,
}));
const { ReportPage } = await import("../ReportPage.jsx");

afterEach(() => { cleanup(); listReports.mockReset(); runReport.mockReset(); downloadReportCsv.mockReset(); });

const META = {
  key: "sales.daily", group: "sales", title: "Daily totals", description: "Totals per day",
  featured: false, favorite: false, available: true, missing: [], paging: "client",
  params: [{ name: "range", label: "Range", type: "dateRange", default: "last30" }],
  columns: [
    { id: "day", label: "Day", type: "date" },
    { id: "total", label: "Total", type: "money" },
  ],
};
const RESULT = {
  rows: [{ day: "2026-10-30", total: 1250 }, { day: "2026-10-31", total: -500 }],
  total: 2, truncated: false, generatedAt: "2026-11-05T15:00:00.000Z", tookMs: 412,
};

let location;
function Probe() {
  location = useLocation();
  return null;
}

function mount({ meta = META, url = "/reports/sales.daily" } = {}) {
  listReports.mockResolvedValue({ groups: [{ key: "sales", title: "Sales", position: 1 }], reports: [meta] });
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <Routes><Route path="/reports/:key" element={<><ReportPage /><Probe /></>} /></Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

test("runs with defaults on load", async () => {
  runReport.mockResolvedValue(RESULT);
  mount();
  assert.ok(await screen.findByText("$12.50"));
  assert.ok(screen.getByText("-$5.00"));
  assert.equal(runReport.mock.calls.length, 1);
  assert.equal(runReport.mock.calls[0][0], "sales.daily");
  assert.deepEqual(runReport.mock.calls[0][1], { range: "last30" });
  assert.ok(screen.getByText(/took 0\.4 s/));
});

test("params in the URL win over defaults", async () => {
  runReport.mockResolvedValue(RESULT);
  mount({ url: "/reports/sales.daily?p.range=2026-10-01..2026-10-31" });
  await screen.findByText("$12.50");
  assert.deepEqual(runReport.mock.calls[0][1], { range: "2026-10-01..2026-10-31" });
});

test("changing the date preset updates the URL p.range and reruns", async () => {
  runReport.mockResolvedValue(RESULT);
  mount();
  await screen.findByText("$12.50");
  fireEvent.change(screen.getByLabelText("Range"), { target: { value: "last7" } });
  await waitFor(() => assert.equal(runReport.mock.calls.length, 2));
  assert.deepEqual(runReport.mock.calls[1][1], { range: "last7" });
  assert.equal(new URLSearchParams(location.search).get("p.range"), "last7");
});

test("Run reruns with the same params", async () => {
  runReport.mockResolvedValue(RESULT);
  mount();
  await screen.findByText("$12.50");
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  await waitFor(() => assert.equal(runReport.mock.calls.length, 2));
});

test("timeout error shows the server message", async () => {
  runReport.mockRejectedValue({
    response: { status: 503, data: { error: { code: "REPORT_TIMEOUT", message: "This report took too long. Try a shorter date range." } } },
  });
  mount();
  assert.ok(await screen.findByText("This report took too long. Try a shorter date range."));
});

test("notice renders above the table", async () => {
  runReport.mockResolvedValue({ ...RESULT, notice: "Figures before June are estimates.", truncated: true, total: 9000 });
  mount();
  const notice = await screen.findByText("Figures before June are estimates.");
  const table = screen.getByRole("table");
  assert.ok(notice.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(screen.getByText(/first 2 of 9,000 rows/i));
});

test("summary renders as a footer row", async () => {
  runReport.mockResolvedValue({ ...RESULT, summary: { total: 750 } });
  mount();
  await screen.findByText("$12.50");
  const foot = screen.getByRole("table").querySelector("tfoot");
  assert.match(foot.textContent, /Total/);
  assert.match(foot.textContent, /\$7\.50/);
});

test("server-paged report fetches pages with limit, offset and sort", async () => {
  runReport.mockResolvedValue({ ...RESULT, total: 2 });
  mount({ meta: { ...META, paging: "server" } });
  await screen.findByText("$12.50");
  assert.equal(runReport.mock.calls.length, 1);
  assert.deepEqual(runReport.mock.calls[0][1], { range: "last30" });
  assert.deepEqual(runReport.mock.calls[0][2], { limit: 20, offset: 0 });
  fireEvent.click(screen.getByRole("button", { name: /Total/ }));
  await waitFor(() => assert.equal(runReport.mock.calls.length, 2));
  assert.deepEqual(runReport.mock.calls[1][2], { limit: 20, offset: 0, sort: "total" });
});

test("toolbar Export CSV downloads the whole result with the current params", async () => {
  runReport.mockResolvedValue(RESULT);
  downloadReportCsv.mockResolvedValue();
  mount({ url: "/reports/sales.daily?p.range=last7" });
  await screen.findByText("$12.50");
  fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
  await waitFor(() => assert.equal(downloadReportCsv.mock.calls.length, 1));
  assert.deepEqual(downloadReportCsv.mock.calls[0], ["sales.daily", { range: "last7" }]);
});

test("an unknown report key says so", async () => {
  mount({ url: "/reports/nope" });
  assert.ok(await screen.findByText(/Report not found/));
  assert.equal(runReport.mock.calls.length, 0);
});

// ---- Task 3 review follow-ups -------------------------------------------------

const META_N = {
  ...META,
  params: [...META.params, { name: "n", label: "Min", type: "number", default: 10 }],
};
const settle = () => new Promise((r) => setTimeout(r, 60));
const lastParams = () => runReport.mock.calls.at(-1)[1];

test("a param cleared to blank stays blank and is sent blank", async () => {
  runReport.mockResolvedValue(RESULT);
  mount({ meta: META_N });
  await screen.findByText("$12.50");
  assert.deepEqual(lastParams(), { range: "last30", n: "10" });
  fireEvent.change(screen.getByLabelText("Min"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  await waitFor(() => assert.equal(runReport.mock.calls.length, 2));
  assert.deepEqual(lastParams(), { range: "last30", n: "" });
  const search = new URLSearchParams(location.search);
  assert.equal(search.has("p.n"), true);
  assert.equal(search.get("p.n"), "");
  await settle();
  assert.equal(screen.getByLabelText("Min").value, "");
});

test("a picker change keeps unapplied typed edits", async () => {
  runReport.mockResolvedValue(RESULT);
  mount({ meta: META_N });
  await screen.findByText("$12.50");
  fireEvent.change(screen.getByLabelText("Min"), { target: { value: "7" } });
  fireEvent.change(screen.getByLabelText("Range"), { target: { value: "last7" } });
  await waitFor(() => assert.equal(runReport.mock.calls.length, 2));
  assert.deepEqual(lastParams(), { range: "last7", n: "7" });
  assert.equal(screen.getByLabelText("Min").value, "7");
});

test("a half-filled custom range cannot run", async () => {
  runReport.mockResolvedValue(RESULT);
  mount();
  await screen.findByText("$12.50");
  fireEvent.change(screen.getByLabelText("Range"), { target: { value: "custom" } });
  const run = screen.getByRole("button", { name: "Run" });
  assert.equal(run.disabled, true);
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-01" } });
  assert.equal(run.disabled, true);
  fireEvent.click(run);
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-31" } });
  assert.equal(run.disabled, false);
  assert.equal(runReport.mock.calls.length, 1);
  fireEvent.click(run);
  await waitFor(() => assert.equal(runReport.mock.calls.length, 2));
  assert.deepEqual(lastParams(), { range: "2026-10-01..2026-10-31" });
});

test("Run with changed params fires exactly one fetch", async () => {
  runReport.mockResolvedValue(RESULT);
  mount({ meta: META_N });
  await screen.findByText("$12.50");
  fireEvent.change(screen.getByLabelText("Min"), { target: { value: "7" } });
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  await waitFor(() => assert.equal(runReport.mock.calls.length, 2));
  await settle();
  assert.equal(runReport.mock.calls.length, 2);
  assert.deepEqual(lastParams(), { range: "last30", n: "7" });
});

test("server-paged: changing params goes back to page 1 with one fetch", async () => {
  runReport.mockResolvedValue({ ...RESULT, total: 100 });
  mount({ meta: { ...META, paging: "server" } });
  await screen.findByText("$12.50");
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  await waitFor(() => assert.equal(runReport.mock.calls.length, 2));
  assert.equal(runReport.mock.calls[1][2].offset, 20);
  fireEvent.change(screen.getByLabelText("Range"), { target: { value: "last7" } });
  await waitFor(() => assert.equal(runReport.mock.calls.length, 3));
  await settle();
  assert.equal(runReport.mock.calls.length, 3);
  assert.deepEqual(runReport.mock.calls[2][1], { range: "last7" });
  assert.equal(runReport.mock.calls[2][2].offset, 0);
});

test("a report with a chart spec draws it above the table", async () => {
  runReport.mockResolvedValue(RESULT);
  mount({ meta: { ...META, chart: { type: "bar", x: "day", series: [{ field: "total", label: "Total" }] } } });
  await screen.findByText("$12.50");
  const chart = screen.getByTestId("chart");
  assert.equal(chart.textContent, "bar:2");
  assert.ok(chart.compareDocumentPosition(screen.getByRole("table")) & Node.DOCUMENT_POSITION_FOLLOWING);
});
