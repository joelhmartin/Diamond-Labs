import { code128Modules } from "../../lib/code128.js";
import { MARGIN, renderPdf, banners, keyValueGrid, section, paragraph, footer } from "../pdf/pdf-layout.js";

/**
 * Lay out a work ticket model (ticket-model.js) on the shared PDF layer.
 * Thin on purpose: every decision about WHAT prints lives in the model.
 * Header, barcode and banners are always on page 1; a long prescription
 * flows onto further pages rather than being cut.
 */

const MODULE = 1.1; // points per barcode module (~0.39 mm; scans on a laser printer)
const BAR_HEIGHT = 36;

function drawBarcode(doc, text, right, top) {
  const modules = code128Modules(text);
  const width = modules.reduce((s, w) => s + w, 0) * MODULE;
  let x = right - width;
  const left = x;
  modules.forEach((w, i) => {
    if (i % 2 === 0) doc.rect(x, top, w * MODULE, BAR_HEIGHT).fill("#000");
    x += w * MODULE;
  });
  doc.fillColor("#000").font("Helvetica").fontSize(8).text(text, left, top + BAR_HEIGHT + 2, { width, align: "center" });
}

export function renderTicketPdf(model) {
  return renderPdf(model.title, (doc, width) => {
    doc.font("Helvetica-Bold").fontSize(22).text(`Order #${model.orderNumber}`, MARGIN, MARGIN, { width: width / 2 });
    doc.font("Helvetica").fontSize(9).text("WORK TICKET", MARGIN, MARGIN + 26);
    drawBarcode(doc, model.barcodeText, doc.page.width - MARGIN, MARGIN);

    keyValueGrid(doc, model.header, { top: banners(doc, model.banners, MARGIN + BAR_HEIGHT + 22) });

    section(doc, "Devices & lines");
    if (model.lines.length === 0) paragraph(doc, "—");
    for (const l of model.lines) paragraph(doc, `${l.qty} ×   ${l.code}   ${l.name}${l.arch ? `   (${l.arch})` : ""}`);
    if (model.instructions.length) {
      section(doc, "Instructions");
      for (const t of model.instructions) paragraph(doc, `• ${t}`);
    }
    if (model.buildNotes) { section(doc, "Build notes"); paragraph(doc, model.buildNotes); }
    if (model.comments) { section(doc, "Doctor's comments"); paragraph(doc, model.comments); }
    if (model.shipTo) { section(doc, "Ship to"); paragraph(doc, model.shipTo.join("\n")); }
    if (model.answerGroups.length) {
      section(doc, "Prescription");
      for (const g of model.answerGroups) {
        doc.font("Helvetica-Bold").fontSize(9).text(g.title, MARGIN, doc.y, { width });
        doc.font("Helvetica").fontSize(8);
        for (const [label, value] of g.items) doc.text(`${label}: ${value}`, MARGIN + 8, doc.y, { width: width - 8 });
        doc.moveDown(0.2);
      }
    }
    if (model.files.length) { section(doc, "Files"); paragraph(doc, model.files.join("\n")); }
    footer(doc, model.footer);
  });
}
