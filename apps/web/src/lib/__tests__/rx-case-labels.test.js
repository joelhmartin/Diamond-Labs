import { test } from "vitest";
import assert from "node:assert/strict";
import { caseStatusLabel, resolutionLabel } from "../rx-case-labels.js";

test("every case status has a human label, and legacy ones say so", () => {
  for (const s of ["new", "in_review", "awaiting_doctor", "released", "pushed", "failed", "cancelled"]) {
    assert.notEqual(caseStatusLabel(s), s, s);
  }
  assert.equal(caseStatusLabel("released"), "Released to lab");
  assert.equal(caseStatusLabel("pushed"), "Sent to Seazona (legacy)");
});

test("legacy resolution tags stay readable", () => {
  assert.equal(resolutionLabel("pushed"), "Sent to Seazona (legacy)");
  assert.equal(resolutionLabel("manual"), "Added to Seazona by hand (legacy)");
  assert.equal(resolutionLabel(null), null);
  assert.equal(resolutionLabel("pushing"), null);
});
