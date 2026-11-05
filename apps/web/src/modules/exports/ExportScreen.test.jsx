// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../components/ui/Toast.jsx";

const get = vi.fn();
const saveBlob = vi.fn();
vi.mock("../../config/api.js", () => ({ default: { get: (...a) => get(...a) } }));
vi.mock("../../lib/download.js", () => ({ saveBlob: (...a) => saveBlob(...a) }));
const { ExportScreen } = await import("./ExportScreen.jsx");

afterEach(() => { cleanup(); get.mockReset(); saveBlob.mockReset(); });

const CSV = { key: "csv", label: "CSV", extension: "csv" };
const SOURCES = [
  {
    key: "sales", label: "Sales",
    params: [
      { id: "from", label: "From", type: "date", required: true },
      { id: "kind", label: "Kind", type: "select", required: true, options: [{ value: "a", label: "Alpha" }] },
      { id: "tags", label: "Tags", type: "multiselect", options: [{ value: "x", label: "Ex" }, { value: "y", label: "Why" }] },
    ],
    fields: [{ key: "name", label: "Name", type: "text" }, { key: "total", label: "Total", type: "cents" }],
    formats: [CSV, { key: "iif", label: "Ledger file", extension: "iif" }],
  },
  { key: "stock", label: "Stock", params: [], fields: [{ key: "sku", label: "SKU", type: "text" }], formats: [CSV] },
];

function stub() {
  get.mockImplementation((url, cfg) => {
    if (url === "/x/exports") return Promise.resolve({ data: { data: SOURCES } });
    if (url.endsWith("/preview")) {
      return Promise.resolve({ data: { data: { rows: [{ name: "Row one", total: 12345, sku: "S1" }], total: 1, fields: [] } } });
    }
    return Promise.resolve({ data: new Blob(["a"]), headers: { "content-disposition": 'attachment; filename="sales-1.csv"' }, config: cfg });
  });
}
const mount = (props) => render(
  <MemoryRouter><ToastProvider><ExportScreen basePath="/x/exports" {...props} /></ToastProvider></MemoryRouter>,
);
const previewCalls = () => get.mock.calls.filter((c) => c[0].endsWith("/preview"));

test("renders params from the source descriptor and previews on change", async () => {
  stub();
  mount({ defaultSource: "sales" });
  await screen.findByLabelText("From");
  assert.equal(screen.getByLabelText("From").type, "date");
  assert.ok(screen.getByLabelText("Kind"));
  assert.ok(screen.getByRole("button", { name: /Tags/ }));
  assert.equal(previewCalls().length, 0, "no preview until required params are set");

  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-01" } });
  fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "a" } });
  await screen.findByText("Row one");
  assert.equal(screen.getByText("$123.45").tagName, "TD");
  const [url, cfg] = previewCalls().at(-1);
  assert.equal(url, "/x/exports/sales/preview");
  assert.equal(cfg.params.from, "2026-10-01");
  assert.equal(cfg.params.kind, "a");
  assert.equal(cfg.params.limit, 20);
});

test("Download is disabled until required params are filled", async () => {
  stub();
  mount({ defaultSource: "sales" });
  const btn = await screen.findByRole("button", { name: "Download" });
  assert.equal(btn.disabled, true);
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-01" } });
  assert.equal(btn.disabled, true);
  fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "a" } });
  assert.equal(btn.disabled, false);
  fireEvent.click(btn);
  await waitFor(() => assert.equal(saveBlob.mock.calls.length, 1));
  const call = get.mock.calls.find((c) => c[0].includes("download."));
  assert.equal(call[0], "/x/exports/sales/download.csv");
  assert.equal(call[1].responseType, "blob");
  assert.equal(call[1].params.from, "2026-10-01");
  assert.equal(saveBlob.mock.calls[0][0], "sales-1.csv");
});

test("format picker lists only the formats the source supports", async () => {
  stub();
  mount({ defaultSource: "sales" });
  const picker = await screen.findByLabelText("Format");
  assert.deepEqual([...picker.options].map((o) => o.textContent), ["CSV", "Ledger file"]);
  fireEvent.change(screen.getByLabelText("Export"), { target: { value: "stock" } });
  await waitFor(() => assert.deepEqual([...screen.getByLabelText("Format").options].map((o) => o.textContent), ["CSV"]));
  await screen.findByText("S1");
});

test("multiselect values are sent as a comma list", async () => {
  stub();
  mount({ defaultSource: "sales" });
  await screen.findByLabelText("From");
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-01" } });
  fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "a" } });
  fireEvent.click(screen.getByRole("button", { name: /Tags/ }));
  fireEvent.click(await screen.findByLabelText("Ex"));
  fireEvent.click(screen.getByLabelText("Why"));
  await waitFor(() => assert.equal(previewCalls().at(-1)[1].params.tags, "x,y"));
});
