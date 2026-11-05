// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { CalendarGrid } from "./CalendarGrid.jsx";

afterEach(cleanup);

const day = (date, extra = {}) => ({ date, weekday: new Date(`${date}T00:00:00Z`).getUTCDay(), open: true, holiday: null, capacity: 10, count: 2, level: "under", ...extra });
const DAYS = [
  day("2026-11-09"),
  day("2026-11-10", { count: 8, level: "near" }),
  day("2026-11-11", { count: 12, level: "over" }),
  day("2026-11-12", { open: false, holiday: "Veterans Day", count: 0, capacity: null, level: "none" }),
];

function mount(props = {}) {
  const onDayClick = vi.fn();
  render(<CalendarGrid days={DAYS} view="week" anchor="2026-11-10" onAnchorChange={() => {}} onDayClick={onDayClick} {...props} />);
  return onDayClick;
}

test("CalendarGrid tints by level and calls onDayClick with the date", () => {
  const onDayClick = mount();
  const under = screen.getByRole("button", { name: /2026-11-09/ });
  assert.match(under.className, /bg-emerald-50/);
  assert.match(screen.getByRole("button", { name: /2026-11-10/ }).className, /bg-amber-50/);
  const over = screen.getByRole("button", { name: /2026-11-11/ });
  assert.match(over.className, /bg-red-50/);
  assert.ok(over.textContent.includes("12 / 10"));
  fireEvent.click(under);
  assert.deepEqual(onDayClick.mock.calls[0], ["2026-11-09"]);
});

test("closed days render the holiday label and are not clickable", () => {
  const onDayClick = mount();
  assert.ok(screen.getByText("Veterans Day"));
  assert.equal(screen.queryByRole("button", { name: /2026-11-12/ }), null);
  fireEvent.click(screen.getByText("Veterans Day"));
  assert.equal(onDayClick.mock.calls.length, 0);
  assert.match(screen.getByTestId("day-2026-11-12").className, /bg-surface-100/);
});

test("prev and next move the anchor by the view's step", () => {
  const onAnchorChange = vi.fn();
  mount({ onAnchorChange });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  assert.equal(onAnchorChange.mock.calls[0][0], "2026-11-17");
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  assert.equal(onAnchorChange.mock.calls[1][0], "2026-11-03");
});
