// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { BoardTiles } from "./BoardTiles.jsx";

afterEach(cleanup);

const TILES = { pastDue: 3, dueToday: 5, dueTomorrow: 2, onHold: 1, atRisk: 4, today: "2026-11-04", tomorrowDate: "2026-11-05" };

test("tiles show counts and toggle the active tile", () => {
  const onSelect = vi.fn();
  const { rerender } = render(<BoardTiles tiles={TILES} active={null} onSelect={onSelect} />);
  const pastDue = screen.getByRole("button", { name: /Past due/ });
  assert.ok(pastDue.textContent.includes("3"));
  assert.ok(screen.getByRole("button", { name: /Due today/ }).textContent.includes("5"));
  assert.ok(screen.getByRole("button", { name: /Due tomorrow/ }).textContent.includes("2"));
  assert.ok(screen.getByRole("button", { name: /On hold/ }).textContent.includes("1"));
  assert.ok(screen.getByRole("button", { name: /At risk/ }).textContent.includes("4"));
  assert.equal(pastDue.getAttribute("aria-pressed"), "false");

  fireEvent.click(pastDue);
  assert.deepEqual(onSelect.mock.calls[0], ["past_due"]);

  rerender(<BoardTiles tiles={TILES} active="past_due" onSelect={onSelect} />);
  const active = screen.getByRole("button", { name: /Past due/ });
  assert.equal(active.getAttribute("aria-pressed"), "true");
  fireEvent.click(active);
  assert.deepEqual(onSelect.mock.calls[1], [null]);
});

test('Friday shows "Due Mon"', () => {
  render(<BoardTiles tiles={{ ...TILES, today: "2026-11-06", tomorrowDate: "2026-11-09" }} active={null} onSelect={() => {}} />);
  assert.ok(screen.getByRole("button", { name: /Due Mon/ }));
  assert.equal(screen.queryByRole("button", { name: /Due tomorrow/ }), null);
});

test("tiles without data render zeros rather than crashing", () => {
  render(<BoardTiles tiles={null} active={null} onSelect={() => {}} />);
  assert.ok(screen.getByRole("button", { name: /Past due/ }).textContent.includes("0"));
});
