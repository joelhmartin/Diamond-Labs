import { test } from "vitest";
import assert from "node:assert/strict";
import { queueBadge, caseColumns } from "./AdminRxCasesPage.jsx";
import { toCsv } from "../../lib/data-table/csv.js";
import { caseStatusLabel } from "../../lib/rx-case-labels.js";

test("every case status has a human label", () => {
  for (const s of ["new", "in_review", "awaiting_doctor", "released", "pushed", "failed", "cancelled"]) {
    assert.ok(caseStatusLabel(s), `no label for ${s}`);
    assert.notEqual(caseStatusLabel(s), s);
  }
});

test("the lines badge tells staff at a glance whether a case is blocked", () => {
  assert.match(queueBadge({ lineCount: 4, unmappedCount: 1 }), /1 unmapped/);
  assert.match(queueBadge({ lineCount: 4, unmappedCount: 0 }), /4 lines/);
  assert.doesNotMatch(queueBadge({ lineCount: 4, unmappedCount: 0 }), /unmapped/);
});

test("the admin Rx export leaves the patient name out", () => {
  const csv = toCsv([{ caseNumber: "RX-1", patientName: "Jane Patient", practiceName: "Lee Dental", status: "new" }], caseColumns());
  assert.ok(!csv.includes("Patient"), csv);
  assert.ok(!csv.includes("Jane Patient"), csv);
  assert.ok(csv.includes("RX-1") && csv.includes("Lee Dental"));
});
