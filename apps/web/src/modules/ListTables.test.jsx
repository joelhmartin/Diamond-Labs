// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../components/ui/Toast.jsx";
import { ROW_BOX } from "../components/ui/data-table/testing.js";

const get = vi.fn();
const post = vi.fn();
vi.mock("../config/api.js", () => ({ default: { get: (...a) => get(...a), post: (...a) => post(...a), put: vi.fn() } }));
const { HolidaysTable } = await import("./business-calendar/HolidaysTable.jsx");
const { WorkflowsTable } = await import("./workflows/WorkflowsTable.jsx");

afterEach(() => { cleanup(); get.mockReset(); post.mockReset(); });

const wrap = (ui) => render(<MemoryRouter><ToastProvider>{ui}</ToastProvider></MemoryRouter>);

test("HolidaysTable bulk Delete needs a second click and POSTs the selected ids", async () => {
  get.mockResolvedValue({ data: { data: { holidays: [{ id: "h1", date: "2026-11-26", label: "Thanksgiving" }, { id: "h2", date: "2026-12-25", label: "Christmas" }] } } });
  post.mockResolvedValue({ data: { data: { count: 2 } } });
  wrap(<HolidaysTable />);
  await screen.findByText("Thanksgiving");
  screen.getAllByLabelText(ROW_BOX).forEach((b) => fireEvent.click(b));
  fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
  assert.equal(post.mock.calls.length, 0);
  fireEvent.click(screen.getByRole("button", { name: "Click again to delete" }));
  await waitFor(() => assert.equal(post.mock.calls.length, 1));
  assert.equal(post.mock.calls[0][0], "/scheduling/calendar/holidays/delete");
  assert.deepEqual(post.mock.calls[0][1], { ids: ["h1", "h2"] });
});

test("WorkflowsTable row click opens the workflow with the milestones; bulk Deactivate POSTs ids", async () => {
  const workflows = [
    { id: "w1", key: "standard", name: "Standard", totalDays: 5, rushWorkflowKey: "rush", isDefault: true, active: true, stages: [{ key: "a" }] },
    { id: "w2", key: "rush", name: "Rush", totalDays: 2, rushWorkflowKey: null, isDefault: false, active: true, stages: [{ key: "a" }] },
  ];
  const milestones = [{ value: "done", label: "Done" }];
  get.mockResolvedValue({ data: { data: { workflows, milestones } } });
  post.mockResolvedValue({ data: { data: { count: 1 } } });
  const onOpen = vi.fn();
  wrap(<WorkflowsTable onOpen={onOpen} />);
  fireEvent.click(await screen.findByText("Standard"));
  assert.equal(onOpen.mock.calls[0][0].id, "w1");
  assert.deepEqual(onOpen.mock.calls[0][1].milestones, milestones);
});

test("WorkflowsTable bulk Deactivate POSTs the selected ids", async () => {
  get.mockResolvedValue({ data: { data: { workflows: [{ id: "w1", key: "s", name: "Standard", totalDays: 5, isDefault: false, active: true, stages: [] }], milestones: [] } } });
  post.mockResolvedValue({ data: { data: { count: 1 } } });
  wrap(<WorkflowsTable onOpen={() => {}} />);
  await screen.findByText("Standard");
  fireEvent.click(screen.getByLabelText(ROW_BOX));
  fireEvent.click(await screen.findByRole("button", { name: "Deactivate" }));
  await waitFor(() => assert.equal(post.mock.calls.length, 1));
  assert.equal(post.mock.calls[0][0], "/scheduling/workflows/active");
  assert.deepEqual(post.mock.calls[0][1], { ids: ["w1"], active: false });
});
