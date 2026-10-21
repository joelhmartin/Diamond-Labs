import { test } from "vitest";
import assert from "node:assert/strict";
import { dayOf } from "./dates.js";

test("dayOf: a real day passes; impossible or unreadable days are null", () => {
  assert.equal(dayOf("2026-02-28T10:00:00"), "2026-02-28");
  assert.equal(dayOf("2024-02-29"), "2024-02-29");
  for (const bad of ["2025-02-30", "2026-13-45", "0000-00-00T00:00:00", "2025-02-29", "nope", null, 5]) assert.equal(dayOf(bad), null, String(bad));
});
