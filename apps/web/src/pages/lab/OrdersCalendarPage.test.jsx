// @vitest-environment jsdom
import { test, afterEach, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { rangeFor } from "../../modules/business-calendar/index.js";

const get = vi.fn();
vi.mock("../../config/api.js", () => ({ default: { get: (...a) => get(...a) } }));
const { OrdersCalendarPage } = await import("./OrdersCalendarPage.jsx");

afterEach(cleanup);
beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue({
    data: { data: { days: [{ date: "2026-11-10", weekday: 2, open: true, holiday: null, capacity: 10, count: 4, level: "under" }] } },
  });
});

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

function mount(url) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/lab/calendar" element={<OrdersCalendarPage />} />
        <Route path="/lab" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

test("calendar page requests days for the visible month with the chosen basis", async () => {
  mount("/lab/calendar?view=month&basis=units&anchor=2026-11-10");
  await waitFor(() => assert.ok(get.mock.calls.length > 0));
  const { from, to } = rangeFor("2026-11-10", "month");
  assert.deepEqual(get.mock.calls[0], ["/scheduling/calendar/days", { params: { from, to, basis: "units" } }]);
});

test("switching to Orders re-requests the days with the orders basis", async () => {
  mount("/lab/calendar?basis=units&anchor=2026-11-10");
  await waitFor(() => assert.ok(get.mock.calls.length > 0));
  fireEvent.click(screen.getByRole("button", { name: "Orders" }));
  await waitFor(() => assert.equal(get.mock.calls.at(-1)[1].params.basis, "orders"));
});

test("clicking a day navigates to the board filtered by dueOn", async () => {
  mount("/lab/calendar?anchor=2026-11-10");
  const day = await screen.findByRole("button", { name: /2026-11-10/ });
  fireEvent.click(day);
  assert.equal((await screen.findByTestId("where")).textContent, "/lab?dueOn=2026-11-10");
});
