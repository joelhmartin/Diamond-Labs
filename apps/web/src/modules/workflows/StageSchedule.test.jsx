// @vitest-environment jsdom
import { test, afterEach } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup } from "@testing-library/react";
import { StageSchedule } from "./StageSchedule.jsx";

afterEach(cleanup);
const stages = [{ key: "a", label: "Start", targetAt: "2026-11-09" }];

test("target dates are formatted, not raw ISO", () => {
  render(<StageSchedule stages={stages} />);
  assert.ok(screen.getByText("11/09/2026"));
});

test("a host can supply its own date formatter", () => {
  render(<StageSchedule stages={stages} formatDate={(d) => `on ${d}`} />);
  assert.ok(screen.getByText("on 2026-11-09"));
});
