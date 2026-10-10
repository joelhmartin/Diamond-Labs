import { test } from "vitest";
import assert from "node:assert/strict";
import { renderTicketPdf } from "./ticket-pdf.js";
import { buildTicketModel } from "./ticket-model.js";

const detail = {
  order: { orderNumber: 100245, status: "received", rush: true, rushTier: "Expedited", isRemake: false, dueDate: "2026-10-21", receivedAt: new Date(), clientName: "Dr Lee" },
  lines: [{ qty: 1, code: "2608", name: "DDSO Nylon", arch: "Upper", noteOnly: false }],
  rxCase: { caseNumber: "RX-ABC", practiceName: "Lee Dental", patientName: "Jane Doe", buildNotes: null, generalComments: null },
  files: [], shopOrder: null,
};

test("the renderer produces a non-empty PDF", async () => {
  const buf = await renderTicketPdf(buildTicketModel(detail, { generatedAt: new Date() }));
  assert.ok(Buffer.isBuffer(buf));
  assert.equal(buf.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.ok(buf.length > 1000, `suspiciously small PDF: ${buf.length} bytes`);
});

test("a long prescription flows onto another page instead of being cut", async () => {
  const answerGroups = [{ title: "Long", items: Array.from({ length: 200 }, (_, i) => ({ label: `Question ${i}`, value: "An answer long enough to wrap onto a second line of the ticket body" })) }];
  const buf = await renderTicketPdf(buildTicketModel(detail, { generatedAt: new Date(), answerGroups }));
  const pages = Number(/\/Count (\d+)/.exec(buf.toString("latin1"))?.[1]);
  assert.ok(pages >= 2, `expected overflow onto page 2+, got ${pages}`);
});
