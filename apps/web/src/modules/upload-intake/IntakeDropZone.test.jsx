// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ToastProvider } from "../../components/ui/Toast.jsx";

const post = vi.fn();
vi.mock("../../config/api.js", () => ({ default: { post: (...a) => post(...a) } }));
const { IntakeDropZone, refusedText } = await import("./IntakeDropZone.jsx");

afterEach(() => { cleanup(); post.mockReset(); });

test("refusedText counts refused files by reason and never names them", () => {
  const text = refusedText([
    { name: "jane-doe.exe", reason: "unsupported type", message: "\"jane-doe.exe\" was not added" },
    { name: "jane-doe.zip", reason: "unsupported type", message: "\"jane-doe.zip\" was not added" },
    { name: "jane-doe.stl", reason: "could not be stored", message: "\"jane-doe.stl\" could not be stored" },
  ]);
  assert.equal(text, "2 files were refused: unsupported type. 1 file was refused: could not be stored.");
  assert.doesNotMatch(text, /jane/);
});

test("a drop with refused files toasts the count, not the file names", async () => {
  post.mockResolvedValue({ data: { data: { intakes: [{ id: "i1" }], refused: [
    { name: "jane-doe.exe", reason: "unsupported type", message: "\"jane-doe.exe\" was not added" },
    { name: "jane-doe.zip", reason: "unsupported type", message: "\"jane-doe.zip\" was not added" },
  ] } } });
  render(<ToastProvider><IntakeDropZone /></ToastProvider>);
  fireEvent.change(screen.getByTestId("file-drop-input"), { target: { files: [new File(["x"], "a.stl")] } });
  assert.ok(await screen.findByText("2 files were refused: unsupported type."));
  assert.equal(screen.queryByText(/jane-doe/), null);
});
