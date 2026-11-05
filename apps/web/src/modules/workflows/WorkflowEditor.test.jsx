// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ToastProvider } from "../../components/ui/Toast.jsx";

const put = vi.fn();
const post = vi.fn();
vi.mock("../../config/api.js", () => ({ default: { put: (...a) => put(...a), post: (...a) => post(...a), get: vi.fn() } }));
const { WorkflowEditor } = await import("./WorkflowEditor.jsx");
const { StageSchedule } = await import("./StageSchedule.jsx");

afterEach(() => { cleanup(); put.mockReset(); post.mockReset(); });

const MILESTONES = [{ value: "started", label: "Started" }, { value: "done", label: "Done" }];
const WORKFLOW = {
  id: "w1", key: "standard", name: "Standard", totalDays: 5, rushWorkflowKey: null, isDefault: false, active: true,
  stages: [
    { key: "cut", label: "Cut", milestone: "started", dayOffset: 2 },
    { key: "finish", label: "Finish", milestone: "done", dayOffset: 5 },
  ],
};

function mount(workflow = WORKFLOW, onSaved = vi.fn()) {
  render(<ToastProvider><WorkflowEditor workflow={workflow} milestones={MILESTONES} onSaved={onSaved} onClose={() => {}} /></ToastProvider>);
  return onSaved;
}

test("WorkflowEditor blocks save when the last offset != total days", async () => {
  mount();
  fireEvent.change(screen.getByLabelText("Total days"), { target: { value: "7" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  assert.ok(await screen.findByText("The last stage must fall on the workflow's total days."));
  assert.equal(put.mock.calls.length, 0);
});

test("WorkflowEditor saves a valid template with PUT and reports it", async () => {
  put.mockResolvedValue({ data: { data: { ...WORKFLOW, name: "Standard 2" } } });
  const onSaved = mount();
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Standard 2" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => assert.equal(put.mock.calls.length, 1));
  assert.equal(put.mock.calls[0][0], "/scheduling/workflows/w1");
  assert.equal(put.mock.calls[0][1].name, "Standard 2");
  assert.deepEqual(put.mock.calls[0][1].stages.map((s) => s.key), ["cut", "finish"]);
  await waitFor(() => assert.equal(onSaved.mock.calls.length, 1));
});

test("stages can be added, moved and removed; offsets must not decrease", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Move Finish up" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  assert.ok(await screen.findByText("Stage day offsets must not decrease."));
  fireEvent.click(screen.getByRole("button", { name: "Remove Finish" }));
  assert.equal(screen.queryByDisplayValue("Finish"), null);
  fireEvent.click(screen.getByRole("button", { name: "Add stage" }));
  assert.equal(screen.getAllByLabelText("Stage label").length, 2);
});

test("StageSchedule marks reached stages, shows late ones in red and renders nothing without stages", () => {
  const { container, rerender } = render(
    <StageSchedule stages={[
      { key: "a", label: "Cut", targetAt: "2026-11-09", reached: true },
      { key: "b", label: "Finish", targetAt: "2026-11-10", late: true },
    ]} />,
  );
  assert.ok(screen.getByLabelText("Reached"));
  assert.match(screen.getByText("Finish").closest("li").className, /text-red-600/);
  rerender(<StageSchedule stages={[]} />);
  assert.equal(container.innerHTML, "");
});
