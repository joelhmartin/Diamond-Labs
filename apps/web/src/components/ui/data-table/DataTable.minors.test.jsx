// @vitest-environment jsdom
// Deferred minors from PR #60: Esc scope, row labels, URL read-back, server-mode fetch count and selection.
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
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
  { id: "name", header: "Name", cell: (r) => r.name },
  { id: "status", header: "Status", cell: (r) => r.status },
];
const FILTERS = [{
  id: "status", label: "Status", type: "select",
  options: [{ value: "open", label: "Open" }, { value: "paid", label: "Paid" }],
  match: (r, v) => r.status === v,
}];

function Client({ tableOptions = {}, ...props }) {
  const table = useDataTable({ mode: "client", rows: ROWS, filters: FILTERS, ...tableOptions });
  return <DataTable table={table} columns={COLUMNS} {...props} />;
}

const mount = (ui, entries) => render(
  <MemoryRouter initialEntries={entries}>
    <ToastProvider>{ui}</ToastProvider>
  </MemoryRouter>,
);
const rowOf = (name) => screen.getByText(name).closest("tr");

test("Esc clears the selection, but not when typed in a field or inside a dialog", () => {
  mount(<><Client /><input aria-label="Elsewhere" /></>);
  const selected = () => screen.queryByText(/1 selected/i);
  fireEvent.click(rowOf("Row 01"), { metaKey: true });
  assert.ok(selected());
  fireEvent.keyDown(screen.getByLabelText("Elsewhere"), { key: "Escape" });
  assert.ok(selected(), "Esc typed in an input keeps the selection");
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  const inside = document.createElement("button");
  dialog.appendChild(inside);
  document.body.appendChild(dialog);
  fireEvent.keyDown(inside, { key: "Escape" });
  assert.ok(selected(), "Esc inside a modal keeps the selection");
  fireEvent.keyDown(document.body, { key: "Escape", defaultPrevented: true });
  dialog.remove();
  fireEvent.keyDown(document.body, { key: "Escape" });
  assert.equal(selected(), null, "Esc on the page clears it");
});

test("row checkboxes are named for their row and plain rows carry no aria-selected", () => {
  mount(<Client />);
  assert.ok(screen.getByRole("checkbox", { name: "Select Row 01" }));
  assert.equal(rowOf("Row 01").hasAttribute("aria-selected"), false);
});

test("a table with no row selection can still export its filtered list from the toolbar", () => {
  const saved = [];
  const original = URL.createObjectURL;
  URL.createObjectURL = (blob) => { saved.push(blob); return "blob:x"; };
  URL.revokeObjectURL = () => {};
  try {
    mount(<Client selectable={false} exportFilteredList />);
    assert.equal(screen.queryByRole("checkbox"), null);
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    assert.equal(saved.length, 1);
  } finally {
    URL.createObjectURL = original; // revokeObjectURL stays a no-op: download.js revokes on a timer
  }
});

test("without exportFilteredList a selection-less table shows no export button", () => {
  mount(<Client selectable={false} />);
  assert.equal(screen.queryByRole("button", { name: "Export CSV" }), null);
});

test("a link to the bare page resets the mirrored filters", async () => {
  function Nav() {
    const navigate = useNavigate();
    return <button type="button" onClick={() => navigate("/x")}>bare link</button>;
  }
  mount(<><Client tableOptions={{ urlKey: "inv" }} /><Nav /></>, ["/x?inv.status=open"]);
  assert.equal(screen.getByRole("combobox", { name: "Status" }).value, "open");
  fireEvent.click(screen.getByRole("button", { name: "bare link" }));
  await waitFor(() => assert.equal(screen.getByRole("combobox", { name: "Status" }).value, ""));
  assert.ok(screen.getByText(/1–20 of 25/));
});

test("server mode: the selection survives page changes and a reload", async () => {
  const fetchPage = vi.fn(async ({ page }) => ({ rows: ROWS.slice((page - 1) * 20, page * 20), total: 25 }));
  let api;
  function Server() {
    const table = useDataTable({ mode: "server", fetchPage });
    api = table;
    return <DataTable table={table} columns={COLUMNS} searchPlaceholder="Search rows" />;
  }
  mount(<Server />);
  await screen.findByText("Row 01");
  fireEvent.click(rowOf("Row 01"), { metaKey: true });
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  await screen.findByText("Row 21");
  assert.equal(api.selection.count, 1, "paging keeps the selection");
  fireEvent.click(rowOf("Row 21"), { metaKey: true });
  await act(async () => api.reload());
  await waitFor(() => assert.equal(fetchPage.mock.calls.at(-1)[0].page, 2));
  assert.equal(api.selection.count, 2, "a reload keeps selections on other pages");
});

test("server mode: a search from page 2 is one fetch (page 1 with the new text)", async () => {
  const fetchPage = vi.fn(async ({ page }) => ({ rows: ROWS.slice((page - 1) * 20, page * 20), total: 25 }));
  function Server() {
    const table = useDataTable({ mode: "server", fetchPage });
    return <DataTable table={table} columns={COLUMNS} searchPlaceholder="Search rows" />;
  }
  mount(<Server />);
  await screen.findByText("Row 01");
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  await screen.findByText("Row 21");
  const before = fetchPage.mock.calls.length;
  fireEvent.change(screen.getByPlaceholderText("Search rows"), { target: { value: "Row 0" } });
  await waitFor(() => assert.equal(fetchPage.mock.calls.at(-1)[0].q, "Row 0"), { timeout: 1500 });
  assert.equal(fetchPage.mock.calls.length, before + 1, "one fetch for the search, none for the page reset");
  assert.equal(fetchPage.mock.calls.at(-1)[0].page, 1);
});
