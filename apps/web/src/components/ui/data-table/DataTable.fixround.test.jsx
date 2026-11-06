// @vitest-environment jsdom
// Review fix round 1: server back/forward with q+page, ghost selections after a bulk action, rapid URL writes.
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { useMemo, useState } from "react";
import { MemoryRouter, Router, createPath, parsePath, useNavigate, useLocation } from "react-router-dom";
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

/** A router whose location catches up with each replace() only after `delay` ms, like a slow publish. */
function DelayedRouter({ children, delay = 40 }) {
  const [loc, setLoc] = useState({ pathname: "/x", search: "", hash: "", state: null, key: "0" });
  const navigator = useMemo(() => ({
    createHref: (to) => (typeof to === "string" ? to : createPath(to)),
    go() {}, push() {},
    replace(to) {
      const p = typeof to === "string" ? parsePath(to) : to;
      setTimeout(() => setLoc({ pathname: p.pathname || "/x", search: p.search || "", hash: "", state: null, key: String(Math.random()) }), delay);
    },
  }), [delay]);
  return <Router location={loc} navigator={navigator}>{children}</Router>;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); // outside act on purpose: the router publishes on its own timers

test("a second change that lands after the first write but before the router publishes it never flickers back", async () => {
  const seen = [];
  function Client() {
    const table = useDataTable({ mode: "client", rows: ROWS, filters: FILTERS, urlKey: "t" });
    seen.push(table.filters.status ?? "");
    return <DataTable table={table} columns={COLUMNS} />;
  }
  render(<DelayedRouter><ToastProvider><Client /></ToastProvider></DelayedRouter>);
  const status = () => screen.getByRole("combobox", { name: "Status" });
  fireEvent.change(status(), { target: { value: "open" } });
  await sleep(10); // the first write has been issued; the router has not published it yet
  fireEvent.change(status(), { target: { value: "paid" } });
  await sleep(200);
  assert.equal(status().value, "paid");
  assert.equal(seen.slice(seen.indexOf("paid")).includes("open"), false, `state flickered back: ${seen.join(",")}`);
});

test("a URL the table wrote earlier does not count as its own forever: navigating back to it later is adopted", async () => {
  function Client() {
    const table = useDataTable({ mode: "client", rows: ROWS, filters: FILTERS, urlKey: "t" });
    return <DataTable table={table} columns={COLUMNS} />;
  }
  mount(<Client />);
  const status = () => screen.getByRole("combobox", { name: "Status" });
  const set = async (v, expected) => {
    fireEvent.change(status(), { target: { value: v } });
    await waitFor(() => assert.equal(new URLSearchParams(search).get("t.status"), expected));
  };
  await set("open", "open"); // writes A
  await set("", null); // writes bare
  await set("open", "open"); // writes A again
  act(() => go("/x")); // a sidebar link to the bare page
  await waitFor(() => assert.equal(status().value, ""));
});

test("a bulk action's failed rows on other pages stay selected", async () => {
  const fetchPage = vi.fn(async ({ page }) => ({ rows: ROWS.slice((page - 1) * 10, page * 10), total: 45 }));
  let api;
  const run = async () => ({ ok: 2, failed: [{ id: "#2", rowId: "r2", message: "changed" }] });
  function Server() {
    const table = useDataTable({ mode: "server", fetchPage, initialPageSize: 10 });
    api = table;
    return <DataTable table={table} columns={COLUMNS} bulkActions={[{ id: "go", label: "Go", run }]} />;
  }
  mount(<Server />);
  await screen.findByText("Row 01");
  fireEvent.click(rowOf("Row 01"), { metaKey: true });
  fireEvent.click(rowOf("Row 02"), { metaKey: true });
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  await screen.findByText("Row 11");
  fireEvent.click(rowOf("Row 11"), { metaKey: true });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Go" })));
  assert.equal(api.selection.ids.has("r1"), false);
  assert.equal(api.selection.ids.has("r2"), true, "the row whose action failed stays selected");
});
