// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../components/ui/Toast.jsx";

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();
const patch = vi.fn();
vi.mock("../../config/api.js", () => ({ default: { get: (...a) => get(...a), post: (...a) => post(...a), put: (...a) => put(...a), delete: (...a) => del(...a), patch: (...a) => patch(...a) } }));
const { TagChips, TagPicker, StarToggle, TagDefinitionsAdmin } = await import("./index.js");

afterEach(() => { cleanup(); [get, post, put, del, patch].forEach((m) => m.mockReset()); });
const wrap = (ui) => render(<MemoryRouter><ToastProvider>{ui}</ToastProvider></MemoryRouter>);

const DEFS = [
  { id: "t1", label: "Urgent", color: "red", position: 0, active: true },
  { id: "t2", label: "Check", color: "blue", position: 1, active: true },
];

test("TagChips shows each label, and nothing for none", () => {
  const { container, rerender } = render(<TagChips tags={DEFS} />);
  assert.ok(screen.getByText("Urgent"));
  assert.ok(screen.getByText("Check"));
  rerender(<TagChips tags={[]} />);
  assert.equal(container.textContent, "");
});

test("TagPicker lists active labels, marks the chosen ones and reports the new selection", async () => {
  get.mockResolvedValue({ data: { data: DEFS } });
  const onChange = vi.fn();
  wrap(<TagPicker recordType="widget" value={["t1"]} onChange={onChange} />);
  const urgent = await screen.findByRole("button", { name: "Urgent" });
  assert.equal(urgent.getAttribute("aria-pressed"), "true");
  assert.equal(screen.getByRole("button", { name: "Check" }).getAttribute("aria-pressed"), "false");
  fireEvent.click(screen.getByRole("button", { name: "Check" }));
  assert.deepEqual(onChange.mock.calls[0][0], ["t1", "t2"]);
  fireEvent.click(urgent);
  assert.deepEqual(onChange.mock.calls[1][0], []);
  assert.equal(get.mock.calls[0][0], "/tags/widget/definitions");
});

test("an inactive label already applied still shows, so it can be removed", async () => {
  get.mockResolvedValue({ data: { data: DEFS } });
  const old = { id: "t9", label: "Retired", color: "slate", active: false };
  wrap(<TagPicker recordType="widget" value={["t9"]} applied={[old]} onChange={() => {}} />);
  assert.equal((await screen.findByRole("button", { name: "Retired" })).getAttribute("aria-pressed"), "true");
});

test("StarToggle stars and unstars through PUT and DELETE", async () => {
  put.mockResolvedValue({});
  del.mockResolvedValue({});
  const onChanged = vi.fn();
  wrap(<StarToggle recordType="widget" recordId="w1" starred={false} onChanged={onChanged} />);
  fireEvent.click(screen.getByRole("button", { name: "Star" }));
  await waitFor(() => assert.equal(put.mock.calls[0][0], "/tags/widget/w1/star"));
  await waitFor(() => assert.equal(screen.getByRole("button", { name: "Unstar" }).getAttribute("aria-pressed"), "true"));
  fireEvent.click(screen.getByRole("button", { name: "Unstar" }));
  await waitFor(() => assert.equal(del.mock.calls[0][0], "/tags/widget/w1/star"));
  assert.deepEqual(onChanged.mock.calls.map((c) => c[0]), [true, false]);
});

test("TagDefinitionsAdmin adds a label and deactivates one through the admin routes", async () => {
  get.mockResolvedValue({ data: { data: DEFS } });
  post.mockResolvedValue({ data: { data: { id: "t3" } } });
  patch.mockResolvedValue({ data: { data: {} } });
  wrap(<TagDefinitionsAdmin recordType="widget" />);
  await screen.findByDisplayValue("Urgent");
  assert.equal(get.mock.calls[0][0], "/tags/widget/definitions");
  assert.deepEqual(get.mock.calls[0][1], { params: { includeInactive: "true" } });
  fireEvent.change(screen.getByPlaceholderText("New label"), { target: { value: "Remake" } });
  fireEvent.click(screen.getByRole("button", { name: "Add label" }));
  await waitFor(() => assert.equal(post.mock.calls[0][0], "/admin/tags/widget/definitions"));
  assert.deepEqual(post.mock.calls[0][1], { label: "Remake", color: "slate" });
  fireEvent.click(screen.getAllByRole("button", { name: "Deactivate" })[0]);
  await waitFor(() => assert.equal(patch.mock.calls[0][0], "/admin/tags/widget/definitions/t1"));
  assert.deepEqual(patch.mock.calls[0][1], { active: false });
});
