import { test } from "vitest";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
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

/** Text shown by a pdfkit document: inflate each stream, join the string pieces of every TJ/Tj. */
function pdfText(buf) {
  const raw = buf.toString("latin1");
  const out = [];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content;
    try { content = inflateSync(Buffer.from(m[1], "latin1")).toString("latin1"); } catch { continue; }
    for (const op of content.matchAll(/\[((?:[^\]]*))\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj|\(((?:\\.|[^)])*)\)\s*Tj/g)) {
      const piece = op[1] ?? op[2] ?? op[3] ?? "";
      out.push([...piece.matchAll(/<([0-9a-fA-F]*)>|\(((?:\\.|[^)])*)\)/g)].map((p) => (p[1] !== undefined ? Buffer.from(p[1], "hex").toString("latin1") : p[2])).join("") || (op[2] ? Buffer.from(op[2], "hex").toString("latin1") : op[3] ?? ""));
    }
  }
  return out.join("\n");
}

test("pdf renders with a schedule", async () => {
  const planned = {
    ...detail,
    schedule: { workflowName: "10-day Printed", stages: [{ label: "Check in", targetAt: "2026-10-07", reached: true }, { label: "Quality check", targetAt: "2026-10-19", reached: false }] },
  };
  const buf = await renderTicketPdf(buildTicketModel(planned, { generatedAt: new Date() }));
  assert.ok(buf.length > 1000);
  const text = pdfText(buf);
  assert.match(text, /Schedule/);
  assert.match(text, /\[x\] Check in/);
  assert.match(text, /\[ \] Quality check/);
  assert.match(text, /DUE WED 10\/21/);
  assert.doesNotMatch(pdfText(await renderTicketPdf(buildTicketModel(detail, { generatedAt: new Date() }))), /Schedule/);
});

test("pdf renders with every addition present", async () => {
  const rich = {
    ...detail,
    order: { ...detail.order, panNumber: "P-4471", deliveryMethod: "fedex", enclosures: [{ kind: "bite" }] },
    lines: [{ id: "l1", qty: 1, code: "2608", name: "DDSO Nylon", arch: "Upper", noteOnly: false, materials: [{ material: "Acrylic", lotNumber: "L77" }] }],
    tags: [{ label: "VIP" }], mergedFrom: [{ orderNumber: 123 }], recordFiles: [{ kind: "photo", originalName: "bite.jpg" }],
  };
  const text = pdfText(await renderTicketPdf(buildTicketModel(rich, { generatedAt: new Date() })));
  assert.match(text, /P-4471/);
  assert.match(text, /FedEx/);
  assert.match(text, /Enclosed/);
  assert.match(text, /\[x\] Bite/);
  assert.match(text, /Acrylic .{1,3} lot L77/);
  assert.match(text, /VIP/);
  assert.match(text, /Merged from #123/);
  assert.match(text, /photo: bite\.jpg/);
  assert.match(text, /DUE WED 10\/21/);
});
