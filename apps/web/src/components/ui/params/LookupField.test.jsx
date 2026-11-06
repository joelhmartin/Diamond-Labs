// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";
import { LookupField } from "../LookupField.jsx";

afterEach(cleanup);

function Harness({ search, onChange }) {
  const [value, setValue] = useState("");
  return (
    <LookupField
      source="client" label="Client" value={value} search={search}
      onChange={(v, opt) => { setValue(v); onChange(v, opt); }}
    />
  );
}

test("debounces the search, then a pick sets the value and shows its label", async () => {
  const search = vi.fn(async (source, q) => (q === "ac" ? [{ value: "c1", label: "Acme" }] : []));
  const onChange = vi.fn();
  render(<Harness search={search} onChange={onChange} />);
  const input = screen.getByRole("combobox", { name: "Client" });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "a" } });
  fireEvent.change(input, { target: { value: "ac" } });
  const option = await screen.findByRole("option", { name: "Acme" });
  // Only the settled text is searched (plus the empty query on open).
  assert.deepEqual(search.mock.calls.map((c) => [c[0], c[1]]).filter(([, q]) => q !== ""), [["client", "ac"]]);
  fireEvent.mouseDown(option);
  assert.deepEqual(onChange.mock.calls[0].slice(0, 1), ["c1"]);
  await waitFor(() => assert.equal(input.value, "Acme"));
  fireEvent.click(screen.getByRole("button", { name: "Clear Client" }));
  assert.equal(onChange.mock.calls[1][0], "");
});

test("a value that arrived by URL shows its label from the server", async () => {
  const labelFor = vi.fn(async (source, value) => ({ value, label: "Acme" }));
  render(<LookupField source="client" label="Client" value="c1" onChange={() => {}} search={async () => []} labelFor={labelFor} />);
  const input = screen.getByRole("combobox", { name: "Client" });
  await waitFor(() => assert.equal(input.value, "Acme"));
  assert.deepEqual(labelFor.mock.calls[0].slice(0, 2), ["client", "c1"]);
});

test("an unknown URL value falls back to the raw value", async () => {
  const labelFor = vi.fn(async () => { throw { response: { status: 404 } }; });
  render(<LookupField source="client" label="Client" value="c9" onChange={() => {}} search={async () => []} labelFor={labelFor} />);
  await waitFor(() => assert.equal(labelFor.mock.calls.length, 1));
  assert.equal(screen.getByRole("combobox", { name: "Client" }).value, "c9");
});

test("a failed search shows the server message in the list", async () => {
  const search = vi.fn(async () => { throw { response: { data: { error: { message: "You cannot view this report." } } } }; });
  render(<Harness search={search} onChange={() => {}} />);
  fireEvent.focus(screen.getByRole("combobox", { name: "Client" }));
  assert.ok(await screen.findByText("You cannot view this report."));
});
