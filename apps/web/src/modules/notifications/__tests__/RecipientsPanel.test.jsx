// @vitest-environment jsdom
import { test, afterEach, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../../components/ui/Toast.jsx";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock("../../../config/api.js", () => ({ default: api }));

import { RecipientsPanel } from "../RecipientsPanel.jsx";

const EVENTS = [{ key: "thing.shipped", label: "Thing shipped" }];
const RECIPIENTS = [{ id: "r1", event: "thing.shipped", channel: "sms", address: "•••4567", label: "Front desk", active: true }];
let channels;

beforeEach(() => {
  channels = { sms: { provider: "off", ok: false, reason: "Text messages are switched off (SMS_PROVIDER=off)" }, email: { configured: true } };
  api.get.mockImplementation(async (url) => {
    if (url === "/admin/notifications/recipients") return { data: { data: RECIPIENTS } };
    if (url === "/admin/notifications/channels") return { data: { data: channels } };
    throw new Error(`unexpected GET ${url}`);
  });
  api.post.mockResolvedValue({ data: { data: { ok: true } } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const mount = () => render(<MemoryRouter><ToastProvider><RecipientsPanel events={EVENTS} /></ToastProvider></MemoryRouter>);

test("shows the SMS provider-off reason", async () => {
  mount();
  await screen.findByText(/switched off \(SMS_PROVIDER=off\)/);
});

test("add rejects an invalid phone inline (no network call)", async () => {
  mount();
  await screen.findByText("Front desk");
  fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: "12345" } });
  fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
  await screen.findByText(/10-digit US number/i);
  assert.equal(api.post.mock.calls.length, 0);
});

test("add posts a normalised number", async () => {
  mount();
  await screen.findByText("Front desk");
  fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: "(512) 555-1234" } });
  fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
  await waitFor(() => assert.equal(api.post.mock.calls[0][0], "/admin/notifications/recipients"));
  assert.deepEqual(api.post.mock.calls[0][1], { event: "thing.shipped", channel: "sms", address: "+15125551234" });
});

test("Send test calls the test endpoint and toasts", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /send test/i }));
  await waitFor(() => assert.deepEqual(api.post.mock.calls[0], ["/admin/notifications/recipients/r1/test"]));
  await screen.findByText(/test sent/i);
});

test("numbers render masked except last 4", async () => {
  mount();
  const cell = await screen.findByText(/4567/);
  assert.match(cell.textContent, /^[•*]*4567$/);
});
