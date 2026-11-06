// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ParamFields } from "./ParamFields.jsx";

afterEach(cleanup);

const SPECS = [
  { name: "range", label: "Range", type: "dateRange" },
  { name: "on", label: "On", type: "date" },
  { name: "n", label: "Count", type: "number", min: 1 },
  { name: "kind", label: "Kind", type: "select", required: true, options: [{ value: "a", label: "Alpha" }] },
  { name: "tags", label: "Tags", type: "multiselect", options: ["x", "y"] },
  { name: "flag", label: "Flagged", type: "toggle" },
  { name: "who", label: "Who", type: "lookup", source: "people" },
];

function mount(values = {}) {
  const onChange = vi.fn();
  const search = vi.fn(async () => [{ value: "p1", label: "Pat" }]);
  render(<ParamFields specs={SPECS} values={values} onChange={onChange} lookup={{ search }} />);
  return { onChange, search };
}

test("one labelled control per param type", () => {
  mount({ range: "last30", tags: "x" });
  assert.equal(screen.getByLabelText("Range").tagName, "SELECT");
  assert.equal(screen.getByLabelText("On").type, "date");
  assert.equal(screen.getByLabelText("Count").type, "number");
  assert.equal(screen.getByLabelText("Kind").options[0].textContent, "Choose…");
  assert.ok(screen.getByRole("group", { name: "Tags" }));
  assert.equal(screen.getByRole("button", { name: "x" }).getAttribute("aria-pressed"), "true");
  assert.equal(screen.getByLabelText("Flagged").type, "checkbox");
  assert.ok(screen.getByRole("combobox", { name: "Who" }));
});

test("picks apply at once; typing does not", () => {
  const { onChange } = mount({ tags: "x" });
  fireEvent.change(screen.getByLabelText("Range"), { target: { value: "ytd" } });
  fireEvent.change(screen.getByLabelText("On"), { target: { value: "2026-10-01" } });
  fireEvent.change(screen.getByLabelText("Count"), { target: { value: "7" } });
  fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "a" } });
  fireEvent.click(screen.getByRole("button", { name: "y" }));
  fireEvent.click(screen.getByLabelText("Flagged"));
  assert.deepEqual(onChange.mock.calls, [
    ["range", "ytd", { apply: true }],
    ["on", "2026-10-01", { apply: true }],
    ["n", "7", { apply: false }],
    ["kind", "a", { apply: true }],
    ["tags", "x,y", { apply: true }],
    ["flag", "true", { apply: true }],
  ]);
});

test("a custom range starts as a held draft; a lookup pick applies through the injected search", async () => {
  const { onChange, search } = mount();
  fireEvent.change(screen.getByLabelText("Range"), { target: { value: "custom" } });
  assert.deepEqual(onChange.mock.calls.at(-1), ["range", "..", { apply: false }]);

  const input = screen.getByRole("combobox", { name: "Who" });
  fireEvent.focus(input);
  fireEvent.mouseDown(await screen.findByRole("option", { name: "Pat" }));
  assert.equal(search.mock.calls[0][0], "people");
  assert.deepEqual(onChange.mock.calls.at(-1), ["who", "p1", { apply: true }]);
});
