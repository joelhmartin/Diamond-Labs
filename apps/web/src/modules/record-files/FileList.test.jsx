// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../config/api.js", () => ({
  default: { get: vi.fn(async () => ({ data: { data: [
    { id: "f1", originalName: "scan.stl", kind: "scan", size: 2 * 1048576 },
    { id: "f2", originalName: "photo.jpg", kind: "photo", size: 2048 },
  ] } })) },
}));

import { ToastProvider } from "../../components/ui/Toast.jsx";
import { FileList } from "./FileList.jsx";

afterEach(cleanup);

test("lists files in a table with name, kind and size; no remove button unless editable", async () => {
  render(
    <MemoryRouter><ToastProvider><FileList recordType="widget" recordId="w1" /></ToastProvider></MemoryRouter>,
  );
  await waitFor(() => screen.getByText("scan.stl"));
  assert.ok(screen.getByRole("table"));
  assert.ok(screen.getByText("2.0 MB"));
  assert.ok(screen.getByText("2 KB"));
  assert.equal(screen.queryByText("Remove"), null);
});
