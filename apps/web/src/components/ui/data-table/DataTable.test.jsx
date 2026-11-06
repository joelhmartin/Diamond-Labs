// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, waitFor, act, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { ToastProvider } from "../Toast.jsx";
import { DataTable } from "./index.js";
import { useDataTable } from "../../../hooks/useDataTable.js";

afterEach(cleanup);

const ROWS = Array.from({ length: 25 }, (_, i) => ({
  id: `r${i + 1}`,
  name: `Row ${String(i + 1).padStart(2, "0")}`,
  status: i % 2 ? "open" : "paid",
}));
const COLUMNS = [
  { id: "name", header: "Name", cell: (r) => r.name, sortValue: (r) => r.name },
  { id: "status", header: "Status", cell: (r) => r.status },
  {
    id: "actions",
    header: "",
    export: false,
    cell: (r) => (
      <>
        <a href={`#${r.id}`}>Open {r.id}</a>
        <button type="button">Refund {r.id}</button>
      </>
    ),
  },
];
const FILTERS = [
  {
    id: "status", label: "Status", type: "select",
    options: [{ value: "open", label: "Open" }, { value: "paid", label: "Paid" }],
    match: (r, v) => r.status === v,
  },
];

function Harness({ tableOptions = {}, ...props }) {
  const table = useDataTable({ mode: "client", rows: ROWS, filters: FILTERS, searchFn: (r, q) => r.name.includes(q), ...tableOptions });
  return <DataTable table={table} columns={COLUMNS} itemLabel="rows" {...props} />;
}

function mount(ui) {
  return render(
    <MemoryRouter>
      <ToastProvider>{ui}</ToastProvider>
    </MemoryRouter>,
  );
}

const bodyRows = () => screen.getAllByRole("row").filter((tr) => tr.closest("tbody"));
const rowOf = (name) => screen.getByText(name).closest("tr");
const isSelected = (name) => within(rowOf(name)).getByRole("checkbox").checked;

test('renders headers and cells from column defs and paginates client rows (25 rows, page size 20 → 20 rows, "1–20 of 25")', () => {
  mount(<Harness />);
  assert.ok(screen.getByRole("columnheader", { name: /Name/ }));
  assert.ok(screen.getByRole("columnheader", { name: /Status/ }));
  assert.equal(bodyRows().length, 20);
  assert.ok(screen.getByText("Row 01"));
  assert.equal(screen.queryByText("Row 21"), null);
  assert.ok(screen.getByText(/1–20 of 25 rows/));
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  assert.equal(bodyRows().length, 5);
  assert.ok(screen.getByText(/21–25 of 25 rows/));
});

test("sortable headers cycle asc, desc and off", () => {
  mount(<Harness />);
  const sortBtn = within(screen.getByRole("columnheader", { name: /Name/ })).getByRole("button");
  fireEvent.click(sortBtn);
  assert.equal(within(bodyRows()[0]).getByText(/^Row/).textContent, "Row 01");
  fireEvent.click(sortBtn);
  assert.equal(within(bodyRows()[0]).getByText(/^Row/).textContent, "Row 25");
  assert.equal(screen.getByRole("columnheader", { name: /Name/ }).getAttribute("aria-sort"), "descending");
  fireEvent.click(sortBtn);
  assert.equal(screen.getByRole("columnheader", { name: /Name/ }).getAttribute("aria-sort"), "none");
});

test("cmd-click toggles, shift-click extends, header checkbox selects the page", () => {
  mount(<Harness />);
  fireEvent.click(rowOf("Row 02"), { metaKey: true });
  assert.ok(isSelected("Row 02"));
  fireEvent.click(rowOf("Row 05"), { shiftKey: true });
  for (const n of ["02", "03", "04", "05"]) assert.ok(isSelected(`Row ${n}`), n);
  assert.ok(!isSelected("Row 06"));
  assert.ok(screen.getByText("4 selected"));
  fireEvent.click(rowOf("Row 03"), { ctrlKey: true });
  assert.ok(!isSelected("Row 03"));
  // the bulk bar replaced the toolbar; clear it and use the header checkbox
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  assert.equal(screen.queryByText(/selected$/), null);
  fireEvent.click(screen.getByRole("checkbox", { name: "Select page" }));
  assert.ok(screen.getByText("20 selected"));
  // client mode offers every matching row once the page is full
  fireEvent.click(screen.getByRole("button", { name: "Select all 25 matching" }));
  assert.ok(screen.getByText("25 selected"));
  fireEvent.keyDown(document, { key: "Escape" });
  assert.equal(screen.queryByText(/selected$/), null);
});

test("plain click selects only that row when the table has no onRowClick", () => {
  mount(<Harness />);
  fireEvent.click(rowOf("Row 01"), { metaKey: true });
  fireEvent.click(rowOf("Row 07"));
  assert.ok(isSelected("Row 07"));
  assert.ok(!isSelected("Row 01"));
});

test("inner controls neither select nor fire onRowClick", () => {
  const onRowClick = vi.fn();
  mount(<Harness onRowClick={onRowClick} />);
  fireEvent.click(screen.getByText("Refund r3"));
  fireEvent.click(screen.getByText("Open r3"), { metaKey: true });
  fireEvent.click(screen.getByText("Refund r4"), { shiftKey: true });
  assert.equal(onRowClick.mock.calls.length, 0);
  assert.ok(!isSelected("Row 03"));
  assert.ok(!isSelected("Row 04"));
  fireEvent.click(rowOf("Row 03"));
  assert.equal(onRowClick.mock.calls.length, 1);
  assert.equal(onRowClick.mock.calls[0][0].id, "r3");
  assert.ok(!isSelected("Row 03"), "a plain click opens instead of selecting");
  // the checkbox itself still selects
  fireEvent.click(within(rowOf("Row 03")).getByRole("checkbox"));
  assert.ok(isSelected("Row 03"));
  assert.equal(onRowClick.mock.calls.length, 1);
});

test("bulk bar shows the count and runs an action with the selected rows; a ConfirmButton action needs two clicks", async () => {
  const archive = vi.fn(async () => {});
  const remove = vi.fn(async () => {});
  mount(
    <Harness
      bulkActions={[
        { id: "archive", label: "Archive", run: archive },
        { id: "delete", label: "Delete", tone: "danger", confirmLabel: "Click again to delete", run: remove },
      ]}
    />,
  );
  fireEvent.click(rowOf("Row 01"), { metaKey: true });
  fireEvent.click(rowOf("Row 02"), { metaKey: true });
  assert.ok(screen.getByText("2 selected"));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Archive" })));
  assert.deepEqual(archive.mock.calls[0][0].map((r) => r.id), ["r1", "r2"]);

  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  assert.equal(remove.mock.calls.length, 0);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Click again to delete" })));
  assert.equal(remove.mock.calls.length, 1);
  assert.deepEqual(remove.mock.calls[0][0].map((r) => r.id), ["r1", "r2"]);
});

test("a failing bulk result toasts the failures", async () => {
  const run = vi.fn(async () => ({ ok: 1, failed: [{ id: "#100231", message: "changed since you loaded it" }] }));
  mount(<Harness bulkActions={[{ id: "move", label: "Move", run }]} />);
  fireEvent.click(rowOf("Row 01"), { metaKey: true });
  fireEvent.click(rowOf("Row 02"), { metaKey: true });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Move" })));
  assert.ok(await screen.findByText("1 done, 1 failed: #100231 changed since you loaded it"));
});

test("a bulk action label can be a function of the selected rows", async () => {
  const run = vi.fn(async () => {});
  mount(<Harness bulkActions={[{ id: "pay", label: (rows) => `Pay ${rows.length}`, run }]} />);
  fireEvent.click(rowOf("Row 01"), { metaKey: true });
  assert.ok(screen.getByRole("button", { name: "Pay 1" }));
  fireEvent.click(rowOf("Row 02"), { metaKey: true });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pay 2" })));
  assert.deepEqual(run.mock.calls[0][0].map((r) => r.id), ["r1", "r2"]);
});

test("inline column definitions (a new array every render) don't make the table re-render itself", async () => {
  let renders = 0;
  function InlineColumns() {
    renders += 1;
    const table = useDataTable({ mode: "client", rows: ROWS });
    return <DataTable table={table} columns={COLUMNS.map((c) => ({ ...c }))} itemLabel="rows" />;
  }
  mount(<InlineColumns />);
  const settled = renders;
  await act(async () => fireEvent.click(rowOf("Row 01"), { metaKey: true }));
  assert.ok(isSelected("Row 01"));
  // One render for the selection change; re-registering identical columns must not schedule another.
  assert.equal(renders - settled, 1);
});

test("a bulk action that throws toasts the error message", async () => {
  const run = vi.fn(async () => { throw new Error("Network down"); });
  mount(<Harness bulkActions={[{ id: "move", label: "Move", run }]} />);
  fireEvent.click(rowOf("Row 01"), { metaKey: true });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Move" })));
  assert.ok(await screen.findByText("Network down"));
});

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test("server mode ignores a slower older response", async () => {
  const pending = {};
  const fetchPage = vi.fn(({ q }) => {
    pending[q] = deferred();
    return pending[q].promise;
  });
  function Server() {
    const table = useDataTable({ mode: "server", fetchPage });
    return <DataTable table={table} columns={COLUMNS} searchPlaceholder="Search rows" />;
  }
  mount(<Server />);
  await waitFor(() => assert.ok(pending[""]));
  await act(async () => pending[""].resolve({ rows: [ROWS[0]], total: 1 }));
  assert.ok(screen.getByText("Row 01"));

  const box = screen.getByPlaceholderText("Search rows");
  fireEvent.change(box, { target: { value: "slow" } });
  await waitFor(() => assert.ok(pending.slow), { timeout: 1500 });
  fireEvent.change(box, { target: { value: "fast" } });
  await waitFor(() => assert.ok(pending.fast), { timeout: 1500 });
  assert.equal(fetchPage.mock.calls.at(-1)[0].page, 1);

  await act(async () => pending.fast.resolve({ rows: [ROWS[1]], total: 1 }));
  await act(async () => pending.slow.resolve({ rows: [ROWS[2]], total: 1 }));
  assert.ok(screen.getByText("Row 02"));
  assert.equal(screen.queryByText("Row 03"), null);
});

test("server mode shows the error inside the table and retries", async () => {
  let fail = true;
  const fetchPage = vi.fn(async () => {
    if (fail) throw { response: { data: { error: { message: "Server said no" } } } };
    return { rows: [ROWS[0]], total: 1 };
  });
  function Server() {
    const table = useDataTable({ mode: "server", fetchPage });
    return <DataTable table={table} columns={COLUMNS} />;
  }
  mount(<Server />);
  assert.ok(await screen.findByText("Server said no"));
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  assert.ok(await screen.findByText("Row 01"));
});

test("changing a filter resets page to 1", async () => {
  mount(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  assert.ok(screen.getByText(/21–25 of 25/));
  fireEvent.change(screen.getByRole("combobox", { name: "Status" }), { target: { value: "open" } });
  assert.ok(screen.getByText(/1–12 of 12/));

  const fetchPage = vi.fn(async ({ page }) => ({ rows: ROWS.slice((page - 1) * 20, page * 20), total: 25 }));
  cleanup();
  function Server() {
    const table = useDataTable({ mode: "server", fetchPage, filters: FILTERS });
    return <DataTable table={table} columns={COLUMNS} />;
  }
  mount(<Server />);
  await screen.findByText("Row 01");
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  await screen.findByText("Row 21");
  fireEvent.change(screen.getByRole("combobox", { name: "Status" }), { target: { value: "paid" } });
  await waitFor(() => assert.deepEqual(
    { page: fetchPage.mock.calls.at(-1)[0].page, filters: fetchPage.mock.calls.at(-1)[0].filters },
    { page: 1, filters: { status: "paid" } },
  ));
});

test("urlKey mirrors search, filters and page into prefixed search params", async () => {
  let search = "";
  function Spy() {
    search = useLocation().search;
    const table = useDataTable({ mode: "client", rows: ROWS, filters: FILTERS, urlKey: "inv", searchFn: (r, q) => r.name.includes(q) });
    return <DataTable table={table} columns={COLUMNS} searchPlaceholder="Search" />;
  }
  render(
    <MemoryRouter initialEntries={["/x?inv.status=open&other=1"]}>
      <ToastProvider><Spy /></ToastProvider>
    </MemoryRouter>,
  );
  assert.equal(screen.getByRole("combobox", { name: "Status" }).value, "open", "reads initial state from the URL");
  assert.ok(screen.getByText(/1–12 of 12/));
  fireEvent.change(screen.getByRole("combobox", { name: "Status" }), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  await waitFor(() => assert.equal(new URLSearchParams(search).get("inv.page"), "2"));
  assert.equal(new URLSearchParams(search).get("inv.status"), null, "a cleared filter leaves the URL");
  assert.equal(new URLSearchParams(search).get("other"), "1", "other params are kept");
  fireEvent.change(screen.getByPlaceholderText("Search"), { target: { value: "Row 1" } });
  await waitFor(() => assert.equal(new URLSearchParams(search).get("inv.q"), "Row 1"), { timeout: 1500 });
  assert.equal(new URLSearchParams(search).get("inv.page"), null, "searching resets to page 1");
});

test("rows carry select-none", () => {
  mount(<Harness />);
  fireEvent.keyDown(window, { key: "Shift", shiftKey: true });
  assert.match(rowOf("Row 01").className, /\bselect-none\b/);
  fireEvent.keyUp(window, { key: "Shift" });
  // a shift-press on the row itself never starts a text selection
  const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true, shiftKey: true });
  rowOf("Row 01").dispatchEvent(down);
  assert.equal(down.defaultPrevented, true);
});

test("server mode bulk actions get the rows from the latest fetch, not the ones selected earlier", async () => {
  let version = 1;
  const fetchPage = vi.fn(async () => ({ rows: ROWS.slice(0, 3).map((r) => ({ ...r, version })), total: 3 }));
  const run = vi.fn(async () => {});
  let api;
  function Server() {
    const table = useDataTable({ mode: "server", fetchPage });
    api = table;
    return <DataTable table={table} columns={COLUMNS} bulkActions={[{ id: "move", label: "Move", run }]} />;
  }
  mount(<Server />);
  await screen.findByText("Row 01");
  fireEvent.click(rowOf("Row 01"), { metaKey: true });
  fireEvent.click(rowOf("Row 02"), { metaKey: true });
  version = 2;
  await act(async () => api.reload());
  await waitFor(() => assert.equal(fetchPage.mock.calls.length, 2));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Move" })));
  assert.deepEqual(run.mock.calls[0][0].map((r) => [r.id, r.version]), [["r1", 2], ["r2", 2]]);
});

test("toolbar Export CSV calls exportAll with current params", async () => {
  // The table passes no arguments: the caller's closure holds its own current params.
  let params = { range: "last30" };
  const exportAll = vi.fn(async () => {});
  const { rerender } = mount(<Harness exportAll={() => exportAll(params)} />);
  params = { range: "last7" };
  rerender(
    <MemoryRouter>
      <ToastProvider><Harness exportAll={() => exportAll(params)} /></ToastProvider>
    </MemoryRouter>,
  );
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Export CSV" })));
  assert.deepEqual(exportAll.mock.calls, [[{ range: "last7" }]]);
});

test("toolbar Export CSV is busy while running and toasts a failure", async () => {
  let fail;
  const exportAll = vi.fn(() => new Promise((_, reject) => { fail = reject; }));
  mount(<Harness exportAll={exportAll} />);
  fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
  const busy = await screen.findByRole("button", { name: /Exporting/ });
  assert.equal(busy.disabled, true);
  await act(async () => fail(new Error("This report took too long. Try a shorter date range.")));
  assert.ok(await screen.findByText("This report took too long. Try a shorter date range."));
  assert.equal(screen.getByRole("button", { name: "Export CSV" }).disabled, false);
});

test("no exportAll, no toolbar export button", () => {
  mount(<Harness />);
  assert.equal(screen.queryByRole("button", { name: /Export CSV/ }), null);
  // Selecting rows still offers the selected-rows export in the bulk bar.
  fireEvent.click(rowOf("Row 01"), { metaKey: true });
  assert.ok(screen.getByRole("button", { name: /Export CSV/ }));
});

test("resultToast: success, partial (warning) or none done (error), longer when something failed", async () => {
  const { resultToast } = await import("./index.js");
  assert.deepEqual(resultToast({ ok: 2, failed: [] }), { message: "2 done", type: "success", duration: 4000 });
  assert.deepEqual(resultToast({ ok: 1, failed: [{ id: "a", message: "x" }] }), { message: "1 done, 1 failed: a x", type: "warning", duration: 8000 });
  assert.equal(resultToast({ ok: 0, failed: [{ id: "a", message: "x" }] }).type, "error");
});

test("a bulk action with choices shows a select and passes the picked value to run", async () => {
  const run = vi.fn(async () => {});
  mount(<Harness bulkActions={[{ id: "set", label: "Set status", choices: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }], run }]} />);
  fireEvent.click(rowOf("Row 01"), { metaKey: true });
  const go = screen.getByRole("button", { name: "Set status" });
  assert.equal(go.disabled, true);
  fireEvent.change(screen.getByLabelText("Set status choice"), { target: { value: "b" } });
  assert.equal(go.disabled, false);
  await act(async () => fireEvent.click(go));
  assert.deepEqual(run.mock.calls[0][0].map((r) => r.id), ["r1"]);
  assert.equal(run.mock.calls[0][1], "b");
});

// ── groupBy ─────────────────────────────────────────────────────────────────

const DAY_ROWS = [
  { id: "a", name: "Alpha", day: "Mon" }, { id: "b", name: "Bravo", day: "Mon" },
  { id: "c", name: "Charlie", day: "Tue" }, { id: "d", name: "Delta", day: "Tue" }, { id: "e", name: "Echo", day: "Wed" },
];
const DAY_COLUMNS = [
  { id: "name", header: "Name", cell: (r) => r.name },
  { id: "day", header: "Day", cell: (r) => r.day },
];
const byDay = { key: (r) => r.day, header: (key, rows) => `${key} · ${rows.length} stops` };

function GroupHarness({ tableOptions = {}, ...props }) {
  const table = useDataTable({ mode: "client", rows: DAY_ROWS, ...tableOptions });
  return <DataTable table={table} columns={DAY_COLUMNS} groupBy={byDay} {...props} />;
}

test("groupBy renders one header row per group with colSpan = column count", () => {
  mount(<GroupHarness />);
  const headers = bodyRows().filter((tr) => tr.hasAttribute("data-group"));
  assert.deepEqual(headers.map((tr) => tr.textContent), ["Mon · 2 stops", "Tue · 2 stops", "Wed · 1 stops"]);
  // Two columns plus the selection column.
  for (const tr of headers) assert.equal(tr.querySelector("td").getAttribute("colspan"), "3");
  assert.equal(bodyRows().length, 8);
  // Data rows follow their header.
  assert.equal(bodyRows()[1].textContent, "AlphaMon");
});

test("group checkbox selects that group's rows only", () => {
  mount(<GroupHarness />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Select group Tue" }));
  assert.equal(isSelected("Charlie"), true);
  assert.equal(isSelected("Delta"), true);
  assert.equal(isSelected("Alpha"), false);
  assert.equal(isSelected("Echo"), false);
  assert.ok(screen.getByText("2 selected"));
  assert.equal(screen.getByRole("checkbox", { name: "Select group Tue" }).checked, true);
  // Clicking it again clears just that group.
  fireEvent.click(screen.getByRole("checkbox", { name: "Select group Mon" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Select group Tue" }));
  assert.equal(isSelected("Charlie"), false);
  assert.equal(isSelected("Alpha"), true);
});

test("groupBy paging counts data rows only, and the group header repeats on the next page", () => {
  mount(<GroupHarness tableOptions={{ initialPageSize: 3 }} />);
  assert.equal(bodyRows().filter((tr) => !tr.hasAttribute("data-group")).length, 3);
  assert.ok(screen.getByText(/1–3 of 5/));
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  const headers = bodyRows().filter((tr) => tr.hasAttribute("data-group")).map((tr) => tr.textContent);
  assert.deepEqual(headers, ["Tue · 1 stops", "Wed · 1 stops"]);
});

test("highlightRowId marks that row (aria-current) and scrolls it into view once", () => {
  const scrolled = [];
  const orig = window.HTMLElement.prototype.scrollIntoView;
  window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() { scrolled.push(this.textContent); };
  try {
    const { rerender } = mount(<Harness highlightRowId="r3" />);
    const current = bodyRows().filter((tr) => tr.getAttribute("aria-current") === "true");
    assert.equal(current.length, 1);
    assert.match(current[0].textContent, /Row 03/);
    assert.equal(scrolled.length, 1);
    rerender(<MemoryRouter><ToastProvider><Harness highlightRowId="r3" /></ToastProvider></MemoryRouter>);
    assert.equal(scrolled.length, 1, "not scrolled again on a re-render");
  } finally {
    window.HTMLElement.prototype.scrollIntoView = orig;
  }
  cleanup();
  mount(<Harness />);
  assert.equal(bodyRows().filter((tr) => tr.hasAttribute("aria-current")).length, 0);
});

test("groupBy works with paginated={false}", () => {
  mount(<GroupHarness paginated={false} tableOptions={{ initialPageSize: 1000 }} />);
  assert.equal(screen.queryByRole("button", { name: "Next page" }), null);
  assert.equal(bodyRows().filter((tr) => tr.hasAttribute("data-group")).length, 3);
});

test("canExpand limits the expander to the rows that have a detail", () => {
  mount(<Harness paginated={false} renderExpanded={(r) => <p>Detail of {r.id}</p>} canExpand={(r) => r.id === "r2"} />);
  assert.equal(screen.getAllByRole("button", { name: "Expand row" }).length, 1);
  fireEvent.click(within(rowOf("Row 02")).getByRole("button", { name: "Expand row" }));
  assert.ok(screen.getByText("Detail of r2"));
});
