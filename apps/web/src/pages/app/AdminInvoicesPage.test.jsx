// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { ToastProvider } from "../../components/ui/Toast.jsx";

const get = vi.fn();
vi.mock("../../config/api.js", () => ({ default: { get: (...a) => get(...a) } }));
const { AdminInvoicesPage } = await import("./AdminInvoicesPage.jsx");

afterEach(() => { cleanup(); get.mockReset(); });

let search = "";
function Probe() {
  search = useLocation().search;
  return null;
}

test("AdminInvoicesPage keeps status, needsPrice, clientUserId and q in the URL and sends them with limit/offset", async () => {
  get.mockResolvedValue({ data: { data: { invoices: [], total: 0 } } });
  const url = "/admin/invoices?" + new URLSearchParams({
    "inv.status": "issued", "inv.needsPrice": "1", "inv.clientUserId": "u-1", "inv.q": "smile", "inv.page": "2",
  });
  render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider><AdminInvoicesPage /><Probe /></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => assert.ok(get.mock.calls.length > 0));
  const [path, opts] = get.mock.calls.at(-1);
  assert.equal(path, "/admin/invoices");
  assert.deepEqual(opts.params, { status: "issued", needsPrice: "true", clientUserId: "u-1", q: "smile", limit: 20, offset: 20 });
  const sp = new URLSearchParams(search);
  assert.equal(sp.get("inv.status"), "issued");
  assert.equal(sp.get("inv.needsPrice"), "1");
  assert.equal(sp.get("inv.clientUserId"), "u-1");
  assert.equal(sp.get("inv.q"), "smile");
  assert.ok(screen.getByText(/One client/i), "the client filter shows as a removable chip");
});
