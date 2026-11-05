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

/** A boxed label (the due-day badge) at x, y; sets the font back to the body face. */
function drawBadge(doc, text, x, y) {
  doc.font("Helvetica-Bold").fontSize(11);
  const w = doc.widthOfString(text) + 16;
  doc.roundedRect(x, y, w, 20, 4).lineWidth(1.2).stroke("#000");
  doc.fillColor("#000").text(text, x + 8, y + 5, { lineBreak: false });
  doc.font("Helvetica");
}

export function renderTicketPdf(model) {
  return renderPdf(model.title, (doc, width) => {
    doc.font("Helvetica-Bold").fontSize(22).text(`Order #${model.orderNumber}`, MARGIN, MARGIN, { width: width / 2 });
    if (model.dueBadge) drawBadge(doc, model.dueBadge, MARGIN + doc.widthOfString(`Order #${model.orderNumber}`) + 12, MARGIN + 3);
    doc.font("Helvetica").fontSize(9).text("WORK TICKET", MARGIN, MARGIN + 26);
    if (model.pan) {
      doc.font("Helvetica-Bold").fontSize(22);
      doc.text(`Pan ${model.pan}`, MARGIN, MARGIN + 38, { lineBreak: false });
      doc.font("Helvetica");
    }
    drawBarcode(doc, model.barcodeText, doc.page.width - MARGIN, MARGIN);

    keyValueGrid(doc, model.header, { top: banners(doc, [...model.banners, ...model.labels], MARGIN + BAR_HEIGHT + 22 + (model.pan ? 14 : 0)) });

    section(doc, "Devices & lines");
    if (model.lines.length === 0) paragraph(doc, "—");
    for (const l of model.lines) {
      paragraph(doc, `${l.qty} ×   ${l.code}   ${l.name}${l.arch ? `   (${l.arch})` : ""}`);
      for (const m of l.materials) doc.font("Helvetica").fontSize(8).text(m, MARGIN + 24, doc.y, { width: width - 24 });
    }
    if (model.enclosed.length) {
      section(doc, "Enclosed");
      for (const e of model.enclosed) paragraph(doc, `[x] ${e}`);
    }
    if (model.mergedFrom) paragraph(doc, `Merged from ${model.mergedFrom}`);
    if (model.schedule.length) {
      section(doc, "Schedule");
      // The standard fonts have no ballot-box glyphs, so the tick is plain ASCII.
      for (const st of model.schedule) paragraph(doc, `${st.reached ? "[x]" : "[ ]"} ${st.label} — ${st.target}`);
    }
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
