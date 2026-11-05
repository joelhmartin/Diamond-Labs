// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

const get = vi.fn();
vi.mock("../../config/api.js", () => ({ default: { get: (...a) => get(...a) } }));

import { ToastProvider } from "../../components/ui/Toast.jsx";
import { ScanBox } from "./ScanBox.jsx";

afterEach(() => { cleanup(); get.mockReset(); });

const hit = (id, title) => ({ recordType: "widget", recordId: id, title, subtitle: "Acme · Received", href: `/w/${id}` });
const Where = () => <div data-testid="where">{useLocation().pathname}</div>;

function setup() {
  render(
    <MemoryRouter initialEntries={["/start"]}>
      <ToastProvider>
        <ScanBox />
        <Routes><Route path="*" element={<Where />} /></Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
  return screen.getByLabelText("Scan a code");
}

const scan = (input, value) => {
  fireEvent.change(input, { target: { value } });
  fireEvent.submit(input.closest("form"));
};

test("one hit navigates", async () => {
  get.mockResolvedValue({ data: { data: { code: "42", hits: [hit("a", "#42")] } } });
  scan(setup(), "42");
  await waitFor(() => assert.equal(screen.getByTestId("where").textContent, "/w/a"));
});

test("many hits render a choice list", async () => {
  get.mockResolvedValue({ data: { data: { code: "42", hits: [hit("a", "#42"), hit("b", "#43")] } } });
  scan(setup(), "42");
  await waitFor(() => screen.getByLabelText("Matches"));
  assert.equal(screen.getAllByRole("button").length, 2);
  assert.equal(screen.getByTestId("where").textContent, "/start");
  fireEvent.click(screen.getByText("#43"));
  await waitFor(() => assert.equal(screen.getByTestId("where").textContent, "/w/b"));
});

test("no hit shows the message and keeps focus", async () => {
  get.mockResolvedValue({ data: { data: { code: "zzz", hits: [] } } });
  const input = setup();
  input.focus();
  scan(input, "zzz");
  await waitFor(() => screen.getByText("No match for zzz"));
  assert.equal(document.activeElement, input);
  assert.equal(input.value, "");
});
