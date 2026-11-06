// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../components/ui/Toast.jsx";

const get = vi.fn();
vi.mock("../../config/api.js", () => ({ default: { get: (...a) => get(...a) } }));
const { AdminRxCasesPage } = await import("./AdminRxCasesPage.jsx");

afterEach(() => { cleanup(); get.mockReset(); });

const rx = (id, caseNumber, status) => ({ id, caseNumber, status, practiceName: "Lee Dental", deviceKey: "crown", lineCount: 1, unmappedCount: 0, createdAt: "2026-11-01T10:00:00Z" });

function mount() {
  get.mockImplementation((_url, cfg) => {
    const resolved = cfg?.params?.status === "released,pushed";
    const data = resolved ? [rx("c3", "RX-300", "released")] : [rx("c1", "RX-100", "new"), rx("c2", "RX-200", "failed")];
    return Promise.resolve({ data: { data } });
  });
  render(<MemoryRouter><ToastProvider><AdminRxCasesPage /></ToastProvider></MemoryRouter>);
}
const pick = (label) => fireEvent.click(screen.getByRole("checkbox", { name: label }));
const openStatus = () => fireEvent.click(screen.getByRole("button", { name: "Status" }));

test("picking Resolved loads released and pushed cases on demand, once", async () => {
  mount();
  await screen.findByText("RX-100");
  assert.equal(screen.queryByText("RX-300"), null, "the open queue does not include resolved cases");
  assert.equal(get.mock.calls.length, 1);

  openStatus();
  pick(/^Resolved/);
  await screen.findByText("RX-300");
  assert.equal(get.mock.calls.length, 2);
  assert.deepEqual(get.mock.calls[1][1].params, { limit: 200, status: "released,pushed" });

  pick(/^Resolved/);
  pick(/^Resolved/);
  await waitFor(() => assert.ok(screen.getByText("RX-300")));
  assert.equal(get.mock.calls.length, 2, "already loaded: no second fetch");
});

test("clearing the status picker returns to the open queue, not every loaded row", async () => {
  mount();
  await screen.findByText("RX-100");
  openStatus();
  pick(/^Resolved/);
  await screen.findByText("RX-300");
  // Untick everything: the four open statuses that start on, plus Resolved.
  for (const name of [/^Resolved/, /^New/, /^In review/, /^Awaiting doctor/, /^Push failed/]) pick(name);
  await waitFor(() => assert.equal(screen.queryByText("RX-300"), null));
  assert.ok(screen.getByText("RX-100"), "open-queue rows are showing");
  assert.ok(screen.getByText("RX-200"));
});
