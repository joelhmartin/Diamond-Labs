// @vitest-environment jsdom
// Review fix round 1: server back/forward with q+page, ghost selections after a bulk action, rapid URL writes.
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { MemoryRouter, useNavigate, useLocation } from "react-router-dom";
import { ToastProvider } from "../Toast.jsx";
import { DataTable } from "./index.js";
import { useDataTable } from "../../../hooks/useDataTable.js";

afterEach(cleanup);

const ROWS = Array.from({ length: 45 }, (_, i) => ({ id: `r${i + 1}`, name: `Row ${String(i + 1).padStart(2, "0")}`, status: i % 2 ? "open" : "paid" }));
const COLUMNS = [{ id: "name", header: "Name", cell: (r) => r.name }];
const FILTERS = [{
  id: "status", label: "Status", type: "select",
  options: [{ value: "open", label: "Open" }, { value: "paid", label: "Paid" }],
  match: (r, v) => r.status === v,
}];

let search = "";
let go;
function Probe() {
  search = useLocation().search;
  go = useNavigate();
  return null;
}
const mount = (ui, entry = "/x") => render(<MemoryRouter initialEntries={[entry]}><ToastProvider>{ui}<Probe /></ToastProvider></MemoryRouter>);
const rowOf = (name) => screen.getByText(name).closest("tr");

test("server mode: back/forward that changes q and page lands on that page, and the URL keeps it", async () => {
  const fetchPage = vi.fn(async ({ page }) => ({ rows: ROWS.slice((page - 1) * 10, page * 10), total: 45 }));
  function Server() {
    const table = useDataTable({ mode: "server", fetchPage, urlKey: "t", initialPageSize: 10 });
    return <DataTable table={table} columns={COLUMNS} />;
  }
  mount(<Server />, "/x?t.q=a&t.page=2");
  await screen.findByText("Row 11");
  act(() => go("/x?t.q=b&t.page=3"));
  await screen.findByText("Row 21");
  const last = fetchPage.mock.calls.at(-1)[0];
  assert.deepEqual([last.q, last.page], ["b", 3]);
  assert.deepEqual([new URLSearchParams(search).get("t.q"), new URLSearchParams(search).get("t.page")], ["b", "3"]);
  assert.equal(fetchPage.mock.calls.some(([r]) => r.q === "b" && r.page === 1), false, "never fetched page 1 for the new q");
});

test("server mode: a bulk action over a cross-page selection leaves no ghost ids behind", async () => {
  const fetchPage = vi.fn(async ({ page }) => ({ rows: ROWS.slice((page - 1) * 10, page * 10), total: 45 }));
  const run = vi.fn(async () => {});
  let api;
  function Server() {
    const table = useDataTable({ mode: "server", fetchPage, initialPageSize: 10 });
    api = table;
    return <DataTable table={table} columns={COLUMNS} bulkActions={[{ id: "go", label: "Go", run }]} />;
  }
  mount(<Server />);
  await screen.findByText("Row 01");
  fireEvent.click(rowOf("Row 01"), { metaKey: true });
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  await screen.findByText("Row 11");
  fireEvent.click(rowOf("Row 11"), { metaKey: true });
  assert.equal(api.selection.count, 2);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Go" })));
  assert.equal(run.mock.calls[0][0].length, 2);
  assert.equal(api.selection.ids.has("r1"), false, "the off-page row that was acted on is deselected");
  assert.equal(api.selection.ids.has("r11"), true, "on-page rows are left to the reload's check");
});

test("two quick changes before the router publishes the first do not revert state", async () => {
  function Client() {
    const table = useDataTable({ mode: "client", rows: ROWS, filters: FILTERS, urlKey: "t", searchFn: (r, q) => r.name.includes(q) });
    return <DataTable table={table} columns={COLUMNS} searchPlaceholder="Search" />;
  }
  mount(<Client />);
  const status = screen.getByRole("combobox", { name: "Status" });
  act(() => {
    fireEvent.change(status, { target: { value: "open" } });
    fireEvent.change(status, { target: { value: "paid" } });
  });
  await waitFor(() => assert.equal(new URLSearchParams(search).get("t.status"), "paid"));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(screen.getByRole("combobox", { name: "Status" }).value, "paid");
  assert.equal(new URLSearchParams(search).get("t.status"), "paid");
});
