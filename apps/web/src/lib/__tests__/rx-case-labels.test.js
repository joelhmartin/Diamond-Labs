import { test } from "vitest";
import assert from "node:assert/strict";
import { resolutionLabel } from "../rx-case-labels.js";

test("resolution label distinguishes a real push from a manual add", () => {
  assert.equal(resolutionLabel("pushed"), "Sent to Seazona");
  assert.equal(resolutionLabel("manual"), "Added manually");
  assert.equal(resolutionLabel(null), null);
  assert.equal(resolutionLabel("pushing"), null);
});
