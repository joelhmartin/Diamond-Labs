import { test } from "vitest";
import assert from "node:assert/strict";
import {
  LabOrderError, nextLabOrderNumber, parseDueDate, rushFromCase, planRxRelease, planShopLabOrder, planRemake,
} from "./lab-order-rules.js";

const now = new Date("2026-10-07T15:00:00Z");
const isCode = (code) => (err) => err instanceof LabOrderError && err.code === code;

test("order numbers continue from the start and never reuse one", () => {
  assert.equal(nextLabOrderNumber(null, 100000), 100000);
  assert.equal(nextLabOrderNumber(100244, 100000), 100245);
  assert.equal(nextLabOrderNumber(12, 100000), 100000, "raising the start later jumps ahead");
  assert.throws(() => nextLabOrderNumber(null, 0), RangeError);
  assert.throws(() => nextLabOrderNumber(null, 1.5), RangeError);
});

test("due dates must be real YYYY-MM-DD dates", () => {
  assert.equal(parseDueDate("2026-10-21"), "2026-10-21");
  assert.equal(parseDueDate(" 2026-10-21 "), "2026-10-21");
  assert.equal(parseDueDate("2026-02-30"), null);
  assert.equal(parseDueDate("10/21/2026"), null);
  assert.equal(parseDueDate(""), null);
  assert.equal(parseDueDate(undefined), null);
});

// Review Focus 4.
test("rush comes from the live form's answers, since the form never sets rx_cases.rush", () => {
  assert.deepEqual(rushFromCase({ rush: false, formData: { rushCase: ["Yes"], rushChargeNylon: "Expedited" } }),
    { rush: true, rushTier: "Expedited" });
  assert.deepEqual(rushFromCase({ formData: { rushCase: ["Yes"], rushChargeNylon: "Max Rush", rushChargeBiomed: "Standard" } }),
    { rush: true, rushTier: "Max Rush / Standard" });
  assert.deepEqual(rushFromCase({ formData: { rushCase: ["Yes"], rushChargeNylon: "Standard", rushChargeBiomed: "Standard" } }),
    { rush: true, rushTier: "Standard" });
});

test("asking for a rush then choosing No Rush everywhere is not a rush; a tick with no tier still is", () => {
  assert.deepEqual(rushFromCase({ formData: { rushCase: ["Yes"], rushChargeNylon: "No Rush", rushChargeBiomed: "No Rush" } }),
    { rush: false, rushTier: null });
  assert.deepEqual(rushFromCase({ formData: { rushCase: ["Yes"] } }), { rush: true, rushTier: null });
  assert.deepEqual(rushFromCase({ formData: { rushChargeNylon: "Expedited" } }), { rush: false, rushTier: null });
  assert.deepEqual(rushFromCase({}), { rush: false, rushTier: null });
});

test("the retired wizard's rush columns still win when set", () => {
  assert.deepEqual(rushFromCase({ rush: true, rushTier: "nylon", formData: null }), { rush: true, rushTier: "nylon" });
});

const caseRow = {
  id: "case-1", userId: "doc-1", status: "in_review", dueDate: null,
  formData: { dueDate: "2026-10-21", rushCase: ["Yes"], rushChargeNylon: "Expedited" },
};
const lines = [
  { mapKey: "primary:ddso:nylon", seazonaCode: "2608", name: "DDSO Nylon", arch: "Upper", status: "confirmed", noteOnly: false, sourceLabel: null },
  { mapKey: "mod:wrap-distal", seazonaCode: null, name: null, arch: null, status: "open", noteOnly: true, sourceLabel: "Wrap distal of last molars" },
  { mapKey: "service:model-fab", seazonaCode: "2367", name: "Model fabrication", arch: null, status: "confirmed", noteOnly: false, sourceLabel: null },
];

test("a released case becomes a received lab order with its lines snapshotted in order", () => {
  const plan = planRxRelease({
    caseRow, lines, variantIdByCode: new Map([["2608", "var-2608"]]),
    orderNumber: 100245, labOrderId: "lo-1", byUserId: "staff-1", now,
  });
  assert.equal(plan.labOrder.id, "lo-1");
  assert.equal(plan.labOrder.orderNumber, 100245);
  assert.equal(plan.labOrder.source, "rx_case");
  assert.equal(plan.labOrder.sourceId, "case-1");
  assert.equal(plan.labOrder.clientUserId, "doc-1");
  assert.equal(plan.labOrder.status, "received");
  assert.equal(plan.labOrder.version, 1);
  assert.equal(plan.labOrder.dueDate, "2026-10-21", "falls back to formData.dueDate");
  assert.equal(plan.labOrder.rush, true);
  assert.equal(plan.labOrder.rushTier, "Expedited");
  assert.equal(plan.labOrder.isRemake, false);
  assert.deepEqual(plan.lines.map((l) => [l.position, l.code, l.variantId, l.noteOnly, l.name]), [
    [0, "2608", "var-2608", false, "DDSO Nylon"],
    [1, null, null, true, "Wrap distal of last molars"],
    [2, "2367", null, false, "Model fabrication"],
  ]);
  assert.equal(plan.lines[0].arch, "Upper");
  assert.ok(plan.lines.every((l) => l.labOrderId === "lo-1" && l.qty === 1));
  assert.deepEqual(plan.unknownCodes, ["2367"], "a code with no catalog variant is kept and reported");
  assert.deepEqual(plan.event, { labOrderId: "lo-1", type: "release", from: "in_review", to: "received", byUserId: "staff-1", note: null, at: now });
});

test("release re-checks the gate itself and refuses a case with an unresolved line", () => {
  const open = [...lines, { mapKey: "mod:anterior-pad", seazonaCode: null, status: "open", noteOnly: false, sourceLabel: "Anterior Pad" }];
  assert.throws(
    () => planRxRelease({ caseRow, lines: open, orderNumber: 1, labOrderId: "x", now }),
    (err) => isCode("RELEASE_BLOCKED")(err) && err.blocking.includes("mod:anterior-pad"),
  );
  assert.throws(() => planRxRelease({ caseRow, lines: [], orderNumber: 1, labOrderId: "x", now }), isCode("RELEASE_BLOCKED"));
});

test("a case's own dueDate column wins over the form answer", () => {
  const plan = planRxRelease({ caseRow: { ...caseRow, dueDate: "2026-11-01" }, lines, orderNumber: 1, labOrderId: "x", now });
  assert.equal(plan.labOrder.dueDate, "2026-11-01");
  const junk = planRxRelease({ caseRow: { ...caseRow, dueDate: "next week", formData: {} }, lines, orderNumber: 1, labOrderId: "x", now });
  assert.equal(junk.labOrder.dueDate, null);
});

// Review Focus 5.
test("a guest's shop order with a codeless item still makes a lab order — checkout already charged the card", () => {
  const plan = planShopLabOrder({
    orderId: "ord-1", clientUserId: null, orderNumber: 100246, labOrderId: "lo-2", now,
    quoteLines: [
      { variantId: "v-kit", code: null, name: "Bite registration kit", qty: 3, unitCents: 1999 },
      { variantId: "v-case", code: "4410", name: "Retainer case", qty: 1, unitCents: 500 },
    ],
  });
  assert.equal(plan.labOrder.source, "shop_order");
  assert.equal(plan.labOrder.sourceId, "ord-1");
  assert.equal(plan.labOrder.clientUserId, null);
  assert.equal(plan.labOrder.status, "received");
  assert.deepEqual(plan.lines.map((l) => [l.position, l.variantId, l.code, l.qty, l.name]), [
    [0, "v-kit", null, 3, "Bite registration kit"],
    [1, "v-case", "4410", 1, "Retainer case"],
  ]);
  assert.ok(!("unitCents" in plan.lines[0]), "lab lines carry no money");
  assert.equal(plan.event.type, "release");
  assert.equal(plan.event.from, "paid");
});

const shipped = {
  id: "lo-1", orderNumber: 100245, status: "shipped", source: "rx_case", sourceId: "case-1", clientUserId: "doc-1",
};
const shippedLines = [
  { id: "l1", labOrderId: "lo-1", position: 0, variantId: "var-2608", code: "2608", name: "DDSO Nylon", arch: "Upper", qty: 1, noteOnly: false, sourceLabel: null },
];

test("a remake is a new received order for the same case, pointing back at the original", () => {
  const plan = planRemake({ original: shipped, originalLines: shippedLines, reason: " Cracked on seating ", orderNumber: 100300, labOrderId: "lo-9", byUserId: "staff-1", now });
  assert.equal(plan.labOrder.isRemake, true);
  assert.equal(plan.labOrder.remakeOfOrderId, "lo-1");
  assert.equal(plan.labOrder.source, "rx_case");
  assert.equal(plan.labOrder.sourceId, "case-1");
  assert.equal(plan.labOrder.status, "received");
  assert.equal(plan.labOrder.dueDate, null);
  assert.equal(plan.lines[0].code, "2608");
  assert.equal(plan.lines[0].labOrderId, "lo-9");
  assert.ok(!("id" in plan.lines[0]), "copied lines get fresh ids from the service");
  assert.deepEqual(plan.events.map((e) => [e.labOrderId, e.type, e.note]), [
    ["lo-9", "release", "Remake of #100245: Cracked on seating"],
    ["lo-1", "note", "Remake created: #100300"],
  ]);
});

test("only a shipped order can be remade, and only with a reason", () => {
  assert.throws(() => planRemake({ original: { ...shipped, status: "in_production" }, originalLines: [], reason: "x", orderNumber: 1, labOrderId: "x", now }), isCode("INVALID"));
  assert.throws(() => planRemake({ original: shipped, originalLines: [], reason: "   ", orderNumber: 1, labOrderId: "x", now }), isCode("REASON_REQUIRED"));
});
