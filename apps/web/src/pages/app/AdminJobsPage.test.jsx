// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../components/ui/Toast.jsx";

const get = vi.fn();
vi.mock("../../config/api.js", () => ({ default: { get: (...a) => get(...a), post: vi.fn() } }));
const { AdminJobsPage } = await import("./AdminJobsPage.jsx");

afterEach(() => { cleanup(); get.mockReset(); });

const run = (id, jobName, status, over = {}) => ({
  id, jobName, status, trigger: "scheduler", dryRun: true, startedAt: "2026-11-05T10:00:00Z", finishedAt: "2026-11-05T10:00:02Z", summary: null, error: null, ...over,
});
const RUNS = [
  run("r1", "autopay-sweep", "succeeded"),
  run("r2", "autopay-sweep", "failed", { error: "card network down" }),
  run("r3", "statement-email", "succeeded"),
];

async function mount() {
  get.mockImplementation((url) => Promise.resolve(
    url === "/admin/jobs/runs"
      ? { data: { data: { runs: RUNS } } }
      : { data: { data: { jobs: [{ name: "autopay-sweep", description: "Monthly charges" }], liveRun: false } } },
  ));
  render(<MemoryRouter><ToastProvider><AdminJobsPage /></ToastProvider></MemoryRouter>);
  await screen.findByText("card network down");
}
// Body rows of the runs table: [job, status] pairs.
const runRows = () => screen.getAllByRole("row")
  .filter((tr) => tr.closest("tbody"))
  .map((tr) => within(tr).getAllByRole("cell").slice(1, 4).map((td) => td.textContent.trim().toLowerCase()));

test("Jobs runs table: the Job and Status filters narrow the runs together", async () => {
  await mount();
  assert.equal(runRows().length, 3);
  fireEvent.change(screen.getByRole("combobox", { name: "Job" }), { target: { value: "autopay-sweep" } });
  assert.equal(runRows().length, 2);
  fireEvent.change(screen.getByRole("combobox", { name: "Status" }), { target: { value: "failed" } });
  const rows = runRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0][0], "autopay-sweep");
  fireEvent.change(screen.getByRole("combobox", { name: "Job" }), { target: { value: "statement-email" } });
  assert.ok(screen.getByText("No runs recorded yet."), "no failed statement-email run");
});

test("Jobs runs table: search matches the error text", async () => {
  await mount();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "network down" } });
  assert.equal(runRows().length, 1);
  assert.ok(screen.getByText("card network down"));
});
