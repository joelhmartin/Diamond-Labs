import PDFDocument from "pdfkit";
import { code128Modules } from "../../lib/code128.js";

/**
 * Lay out a work ticket model (ticket-model.js) as a letter-size PDF. Thin
 * on purpose: every decision about WHAT prints lives in the model. Header,
 * barcode and banners are always on page 1; a long prescription flows onto
 * further pages rather than being cut.
 */

const MARGIN = 36;   // half an inch
const MODULE = 1.1;  // points per barcode module (~0.39 mm; scans on a laser printer)
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
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: MARGIN, info: { Title: model.title } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const width = doc.page.width - MARGIN * 2;

    doc.font("Helvetica-Bold").fontSize(22).text(`Order #${model.orderNumber}`, MARGIN, MARGIN, { width: width / 2 });
    doc.font("Helvetica").fontSize(9).text("WORK TICKET", MARGIN, MARGIN + 26);
    drawBarcode(doc, model.barcodeText, doc.page.width - MARGIN, MARGIN);

    let y = MARGIN + BAR_HEIGHT + 22;
    for (const banner of model.banners) {
      doc.rect(MARGIN, y, width, 20).fill("#000");
      doc.fillColor("#fff").font("Helvetica-Bold").fontSize(12).text(banner, MARGIN + 8, y + 5, { width: width - 16 });
      doc.fillColor("#000");
      y += 24;
    }

    const colW = width / 2;
    doc.fontSize(9);
    model.header.forEach(([label, value], i) => {
      const x = MARGIN + (i % 2) * colW;
      const rowY = y + 4 + Math.floor(i / 2) * 14;
      doc.font("Helvetica-Bold").text(label, x, rowY, { width: 72, lineBreak: false });
      doc.font("Helvetica").text(String(value), x + 74, rowY, { width: colW - 82, lineBreak: false, ellipsis: true });
    });
    doc.x = MARGIN;
    doc.y = y + 4 + Math.ceil(model.header.length / 2) * 14 + 6;

    const section = (title) => {
      doc.moveDown(0.6);
      doc.font("Helvetica-Bold").fontSize(11).text(title, MARGIN, doc.y, { width });
      doc.moveTo(MARGIN, doc.y + 1).lineTo(MARGIN + width, doc.y + 1).lineWidth(0.5).stroke();
      doc.moveDown(0.3);
      doc.font("Helvetica").fontSize(9);
    };

    section("Devices & lines");
    if (model.lines.length === 0) doc.text("—", MARGIN, doc.y, { width });
    for (const l of model.lines) {
      doc.text(`${l.qty} ×   ${l.code}   ${l.name}${l.arch ? `   (${l.arch})` : ""}`, MARGIN, doc.y, { width });
    }
    if (model.instructions.length) {
      section("Instructions");
      for (const t of model.instructions) doc.text(`• ${t}`, MARGIN, doc.y, { width });
    }
    if (model.buildNotes) { section("Build notes"); doc.text(model.buildNotes, MARGIN, doc.y, { width }); }
    if (model.comments) { section("Doctor's comments"); doc.text(model.comments, MARGIN, doc.y, { width }); }
    if (model.shipTo) { section("Ship to"); doc.text(model.shipTo.join("\n"), MARGIN, doc.y, { width }); }
    if (model.answerGroups.length) {
      section("Prescription");
      for (const g of model.answerGroups) {
        doc.font("Helvetica-Bold").fontSize(9).text(g.title, MARGIN, doc.y, { width });
        doc.font("Helvetica").fontSize(8);
        for (const [label, value] of g.items) doc.text(`${label}: ${value}`, MARGIN + 8, doc.y, { width: width - 8 });
        doc.moveDown(0.2);
      }
    }
    if (model.files.length) { section("Files"); doc.text(model.files.join("\n"), MARGIN, doc.y, { width }); }

    doc.moveDown(1).font("Helvetica-Oblique").fontSize(7).fillColor("#444").text(model.footer, MARGIN, doc.y, { width });
    doc.end();
  });
}
