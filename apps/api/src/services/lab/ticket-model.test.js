import { test } from "vitest";
import assert from "node:assert/strict";
import { buildTicketModel, printable } from "./ticket-model.js";

const generatedAt = new Date("2026-10-07T15:00:00Z");
const rxDetail = {
  order: {
    orderNumber: 100245, status: "in_production", rush: true, rushTier: "Expedited", isRemake: true, remakeOfOrderNumber: 100200,
    dueDate: "2026-10-21", receivedAt: new Date("2026-10-07T03:00:00Z"), clientName: "Dr Amy Lee",
    departmentName: "Acrylic", assigneeName: "Maria Lopez",
  },
  lines: [
    { qty: 1, code: "2608", name: "DDSO Nylon", arch: "Upper", noteOnly: false },
    { qty: 1, code: null, name: "Wrap distal", sourceLabel: "Wrap distal of last molars", arch: null, noteOnly: true },
  ],
  rxCase: { caseNumber: "RX-ABC", practiceName: "Lee Dental", patientName: "Jane Doe", buildNotes: "[DDSO] Occlusal Contact: TRIPOD", generalComments: "Thin as possible" },
  files: [{ kind: "scan", originalName: "upper.stl" }],
  shopOrder: null,
};

// Review Focus 4 (the printed half).
test("rush and remake are banners a technician can't miss", () => {
  const m = buildTicketModel(rxDetail, { generatedAt });
  assert.deepEqual(m.banners, ["RUSH — Expedited", "REMAKE of #100200"]);
  assert.deepEqual(buildTicketModel({ ...rxDetail, order: { ...rxDetail.order, rush: true, rushTier: null, isRemake: false } }, { generatedAt }).banners, ["RUSH"]);
  assert.deepEqual(buildTicketModel({ ...rxDetail, order: { ...rxDetail.order, rush: false, isRemake: false, status: "on_hold" } }, { generatedAt }).banners, ["ON HOLD"]);
});

test("the bench gets the patient, practice, doctor, dates and the barcode text", () => {
  const m = buildTicketModel(rxDetail, { generatedAt });
  const h = Object.fromEntries(m.header);
  assert.equal(m.barcodeText, "100245");
  assert.equal(h.Patient, "Jane Doe");
  assert.equal(h.Practice, "Lee Dental");
  assert.equal(h.Doctor, "Dr Amy Lee");
  assert.equal(h.Case, "RX-ABC");
  assert.equal(h.Due, "10/21/2026");
  assert.equal(h.Received, "10/06/2026", "received is the lab's date, not UTC's");
  assert.equal(h.Status, "In production");
});

test("devices print as lines; instructions print separately; files and notes are listed", () => {
  const m = buildTicketModel(rxDetail, { generatedAt, answerGroups: [{ title: "DDSO", items: [{ label: "Modifications", value: "Wrap distal" }] }] });
  assert.deepEqual(m.lines, [{ qty: "1", code: "2608", name: "DDSO Nylon", arch: "Upper" }]);
  assert.deepEqual(m.instructions, ["Wrap distal of last molars"]);
  assert.equal(m.buildNotes, "[DDSO] Occlusal Contact: TRIPOD");
  assert.equal(m.comments, "Thin as possible");
  assert.deepEqual(m.files, ["scan: upper.stl"]);
  assert.deepEqual(m.answerGroups, [{ title: "DDSO", items: [["Modifications", "Wrap distal"]] }]);
  assert.match(m.footer, /10\/07\/2026/);
  assert.match(m.footer, /patient information/);
});

test("a shop order ticket has no patient and prints the ship-to", () => {
  const m = buildTicketModel({
    order: { orderNumber: 100246, status: "received", rush: false, isRemake: false, dueDate: null, receivedAt: generatedAt, clientName: null },
    lines: [{ qty: 3, code: null, name: "Bite registration kit", arch: null, noteOnly: false }],
    rxCase: null, files: [],
    shopOrder: { orderNumber: "DOL-ABC", shipping: { name: "Pat Smith", address1: "1 Main St", city: "Austin", state: "TX", postalCode: "78701" } },
  }, { generatedAt });
  const h = Object.fromEntries(m.header);
  assert.equal(h.Patient, "—");
  assert.equal(h["Shop order"], "DOL-ABC");
  assert.equal(h.Practice, "Pat Smith");
  assert.deepEqual(m.lines, [{ qty: "3", code: "—", name: "Bite registration kit", arch: "" }]);
  assert.deepEqual(m.shipTo, ["Pat Smith", "1 Main St", "Austin, TX 78701"]);
});

test("characters the PDF fonts can't draw become ?, everything else survives", () => {
  assert.equal(printable("Café “Bite” — 2× • ok"), "Café “Bite” — 2× • ok");
  assert.equal(printable("Tooth 😀 #8"), "Tooth ? #8");
  const m = buildTicketModel({ ...rxDetail, rxCase: { ...rxDetail.rxCase, generalComments: "Smile 😀" } }, { generatedAt });
  assert.equal(m.comments, "Smile ?");
});

test("a doctor whose name is the practice's isn't printed twice", () => {
  const m = buildTicketModel({ ...rxDetail, rxCase: { ...rxDetail.rxCase, practiceName: "Dr Amy Lee" } }, { generatedAt });
  const labels = m.header.map(([k]) => k);
  assert.equal(labels.includes("Doctor"), false);
  assert.equal(Object.fromEntries(m.header).Practice, "Dr Amy Lee");
});
