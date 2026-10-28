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
