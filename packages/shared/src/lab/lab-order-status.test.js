import { test } from "vitest";
import assert from "node:assert/strict";
import {
  LAB_ORDER_STATUSES, LAB_BOARD_COLUMNS, LAB_STATUS_LABELS, allowedNextStatuses, canMoveLabOrder,
  reasonRequiredFor, isOverdue, isoDateIn, doctorStatusFor, doctorCaseView, formatUsDate, caseSummary,
} from "./lab-order-status.js";

// The whole table, written out. Every pair not listed here must be refused.
const ALLOWED = {
  received: ["in_production", "on_hold", "cancelled"],
  in_production: ["quality_check", "on_hold", "cancelled"],
  quality_check: ["ready_to_ship", "in_production", "on_hold", "cancelled"],
  ready_to_ship: ["shipped", "quality_check", "on_hold", "cancelled"],
  shipped: [],
  cancelled: [],
};

test("every move between non-hold statuses is exactly the table", () => {
  for (const from of Object.keys(ALLOWED)) {
    for (const to of LAB_ORDER_STATUSES) {
      assert.equal(canMoveLabOrder(from, to), ALLOWED[from].includes(to), `${from} → ${to}`);
    }
  }
});

test("an on-hold order resumes where it was held from, or is cancelled — nothing else", () => {
  for (const heldFrom of ["received", "in_production", "quality_check", "ready_to_ship"]) {
    for (const to of LAB_ORDER_STATUSES) {
      const expected = to === heldFrom || to === "cancelled";
      assert.equal(canMoveLabOrder("on_hold", to, { heldFrom }), expected, `on_hold(${heldFrom}) → ${to}`);
    }
  }
});

test("an on-hold row with no usable heldFrom resumes at received instead of being stuck", () => {
  assert.deepEqual(allowedNextStatuses("on_hold"), ["received", "cancelled"]);
  assert.deepEqual(allowedNextStatuses("on_hold", { heldFrom: "shipped" }), ["received", "cancelled"]);
});

test("unknown or missing statuses allow nothing", () => {
  assert.deepEqual(allowedNextStatuses("bogus"), []);
  assert.deepEqual(allowedNextStatuses(undefined), []);
});

test("hold and cancel need a reason; ordinary moves do not", () => {
  assert.equal(reasonRequiredFor("on_hold"), true);
  assert.equal(reasonRequiredFor("cancelled"), true);
  for (const s of ["received", "in_production", "quality_check", "ready_to_ship", "shipped"]) {
    assert.equal(reasonRequiredFor(s), false, s);
  }
});

test("every status has a staff label and every board column is a status", () => {
  for (const s of LAB_ORDER_STATUSES) assert.ok(LAB_STATUS_LABELS[s], s);
  for (const c of LAB_BOARD_COLUMNS) assert.ok(LAB_ORDER_STATUSES.includes(c), c);
});

test("overdue means past due and still open", () => {
  assert.equal(isOverdue("2026-10-01", "in_production", "2026-10-07"), true);
  assert.equal(isOverdue("2026-10-07", "in_production", "2026-10-07"), false);
  assert.equal(isOverdue("2026-10-01", "shipped", "2026-10-07"), false);
  assert.equal(isOverdue("2026-10-01", "cancelled", "2026-10-07"), false);
  assert.equal(isOverdue(null, "received", "2026-10-07"), false);
});

test("the lab's today is computed in the lab's timezone", () => {
  // 03:00 UTC on Oct 8 is still Oct 7 in San Antonio.
  assert.equal(isoDateIn("America/Chicago", new Date("2026-10-08T03:00:00Z")), "2026-10-07");
});

test("doctors see production in plain words", () => {
  assert.equal(doctorStatusFor({ caseStatus: "released", labOrderStatus: "received" }), "Received");
  for (const s of ["in_production", "quality_check", "ready_to_ship"]) {
    assert.equal(doctorStatusFor({ caseStatus: "released", labOrderStatus: s }), "In production");
  }
  assert.equal(doctorStatusFor({ caseStatus: "released", labOrderStatus: "on_hold" }), "On hold");
  assert.equal(doctorStatusFor({ caseStatus: "released", labOrderStatus: "shipped" }), "Shipped");
  assert.equal(doctorStatusFor({ caseStatus: "new" }), "Submitted");
  assert.equal(doctorStatusFor({ caseStatus: "awaiting_doctor" }), "Submitted");
  assert.equal(doctorStatusFor({ caseStatus: "pushed" }), "Sent to lab");
  assert.equal(doctorStatusFor({ caseStatus: "cancelled" }), "Cancelled");
});

const caseRow = {
  id: "c1", caseNumber: "RX-ABC", patientFirst: "Jane", patientLast: "Doe", status: "released",
  createdAt: "2026-10-01T10:00:00Z", dueDate: "2026-10-20",
  deviceOptions: { devices: [{ deviceKey: "ddso", label: "DDSO" }, { deviceKey: "guard", label: "Nightguard" }] },
};

// Review Focus 2.
test("a case on hold shows On hold to the doctor and never the reason, notes, or who has it", () => {
  const held = {
    id: "lo1", orderNumber: 100245, status: "on_hold", holdReason: "Bite is wrong — call Dr Lee about Jane",
    labNotes: "Redo the scan trim", assigneeUserId: "u-tech", departmentId: "d-acrylic",
    dueDate: "2026-10-22", isRemake: false, createdAt: "2026-10-02T10:00:00Z",
  };
  const view = doctorCaseView(caseRow, [held]);
  assert.equal(view.status, "On hold");
  const json = JSON.stringify(view);
  for (const secret of ["Bite is wrong", "Redo the scan", "u-tech", "d-acrylic", "holdReason", "labNotes"]) {
    assert.ok(!json.includes(secret), `leaked ${secret}`);
  }
  assert.deepEqual(Object.keys(view).sort(), [
    "caseNumber", "deviceSummary", "dueDate", "id", "isRemake", "orderNumber", "patientName", "status", "submittedAt",
  ]);
});

test("the newest lab order (a remake) is what the doctor sees", () => {
  const original = { status: "shipped", isRemake: false, orderNumber: 100245, dueDate: "2026-10-10", createdAt: "2026-10-02T10:00:00Z" };
  const remake = { status: "received", isRemake: true, orderNumber: 100300, dueDate: null, createdAt: "2026-10-15T10:00:00Z" };
  const view = doctorCaseView(caseRow, [original, remake]);
  assert.equal(view.status, "Received");
  assert.equal(view.isRemake, true);
  assert.equal(view.orderNumber, 100300);
  assert.equal(view.dueDate, "2026-10-20"); // the remake has no due date yet → the case's requested date
  assert.equal(view.deviceSummary, "DDSO, Nightguard");
  assert.equal(view.patientName, "Jane Doe");
});

test("a case not yet released has no lab order", () => {
  const view = doctorCaseView({ ...caseRow, status: "in_review" }, []);
  assert.equal(view.status, "Submitted");
  assert.equal(view.orderNumber, null);
  assert.equal(view.isRemake, false);
});

test("a case whose PHI failed to decrypt still renders", () => {
  const view = doctorCaseView({ id: "c2", caseNumber: "RX-X", status: "new", patientFirst: null, patientLast: null, deviceOptions: null }, []);
  assert.equal(view.patientName, null);
  assert.equal(view.deviceSummary, null);
});

test("formatUsDate renders MM/DD/YYYY and tolerates null or junk", () => {
  assert.equal(formatUsDate("2026-10-07"), "10/07/2026");
  assert.equal(formatUsDate("2026-10-07T03:00:00Z"), "10/07/2026");
  assert.equal(formatUsDate(null), "");
  assert.equal(formatUsDate("nope"), "");
});

test("caseSummary is the one place patient name and devices are composed", () => {
  assert.deepEqual(caseSummary(caseRow), { patientName: "Jane Doe", deviceSummary: "DDSO, Nightguard" });
  assert.deepEqual(caseSummary({ patientFirst: "Jane", deviceOptions: { devices: [{ deviceKey: "guard" }] } }), { patientName: "Jane", deviceSummary: "guard" });
  assert.deepEqual(caseSummary({}), { patientName: null, deviceSummary: null });
  assert.deepEqual(caseSummary(null), { patientName: null, deviceSummary: null });
});
