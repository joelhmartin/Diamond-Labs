// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../components/ui/Toast.jsx";
import { ROW_BOX } from "../../components/ui/data-table/testing.js";

const get = vi.fn();
const put = vi.fn();
vi.mock("../../config/api.js", () => ({ default: { get: (...a) => get(...a), put: (...a) => put(...a), post: vi.fn() } }));
const { AssignmentsTable } = await import("./AssignmentsTable.jsx");

afterEach(() => { cleanup(); get.mockReset(); put.mockReset(); });

const SUBJECTS = [{ id: "s1", name: "Alpha" }, { id: "s2", name: "Beta" }, { id: "s3", name: "Gamma" }];
const COLUMNS = [{ id: "name", header: "Name", cell: (r) => r.name }];
const WORKFLOWS = [{ key: "standard", name: "Standard" }, { key: "rush", name: "Rush" }];

function mount() {
  get.mockResolvedValue({ data: { data: { assignments: [{ subjectId: "s1", workflowKey: "standard" }] } } });
  put.mockResolvedValue({ data: { data: { count: 2 } } });
  render(
    <MemoryRouter><ToastProvider>
      <AssignmentsTable subjectType="variant" subjects={SUBJECTS} columns={COLUMNS} workflows={WORKFLOWS} />
    </ToastProvider></MemoryRouter>,
  );
}

async function selectRows(...indexes) {
  await screen.findByText("Alpha");
  const boxes = screen.getAllByLabelText(ROW_BOX);
  indexes.forEach((i) => fireEvent.click(boxes[i]));
}

test("AssignmentsTable shows each subject's current workflow", async () => {
  mount();
  await screen.findByRole("cell", { name: "Standard" });
  assert.equal(get.mock.calls[0][0], "/scheduling/workflows/assignments");
  assert.deepEqual(get.mock.calls[0][1], { params: { subjectType: "variant" } });
});

test("AssignmentsTable bulk Set workflow PUTs the selected ids", async () => {
  mount();
  await selectRows(1, 2);
  fireEvent.change(await screen.findByLabelText("Set workflow… choice"), { target: { value: "rush" } });
  fireEvent.click(screen.getByRole("button", { name: "Set workflow…" }));
  await waitFor(() => assert.equal(put.mock.calls.length, 1));
  assert.equal(put.mock.calls[0][0], "/scheduling/workflows/assignments");
  assert.deepEqual(put.mock.calls[0][1], { subjectType: "variant", subjectIds: ["s2", "s3"], workflowKey: "rush" });
});

test("AssignmentsTable bulk Clear workflow PUTs a null key", async () => {
  mount();
  await selectRows(0);
  fireEvent.click(await screen.findByRole("button", { name: "Clear workflow" }));
  await waitFor(() => assert.equal(put.mock.calls.length, 1));
  assert.deepEqual(put.mock.calls[0][1], { subjectType: "variant", subjectIds: ["s1"], workflowKey: null });
});
