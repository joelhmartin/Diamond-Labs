import PDFDocument from "pdfkit";

/**
 * The one PDF layer. Letter size, half-inch margins, the Helvetica family, and
 * the blocks every printed document is made of: a title, black banners, a
 * label/value grid, ruled sections, a table, a totals block and a footer.
 * Renderers (lab ticket, invoice, statement) only arrange these blocks; the
 * models decide what prints. Text must already be WinAnsi-safe (pdf-text.js).
 */
export const MARGIN = 36; // half an inch

export const contentWidth = (doc) => doc.page.width - MARGIN * 2;

/** Run `draw(doc, width)` on a fresh letter-size document; resolves to the PDF bytes. */
export function renderPdf(title, draw) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: MARGIN, info: { Title: title } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      draw(doc, contentWidth(doc));
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/** A large title with a small caption under it, top left; returns the y below them. */
export function titleBlock(doc, { title, caption }) {
  const width = contentWidth(doc);
  doc.font("Helvetica-Bold").fontSize(22).text(title, MARGIN, MARGIN, { width });
  doc.font("Helvetica").fontSize(9).text(caption, MARGIN, MARGIN + 26, { width });
  return MARGIN + 40;
}

/** Full-width black bars with white text (RUSH, ON HOLD, DRAFT, VOID); returns the y below them. */
export function banners(doc, list, y) {
  const width = contentWidth(doc);
  let at = y;
  for (const banner of list) {
    doc.rect(MARGIN, at, width, 20).fill("#000");
    doc.fillColor("#fff").font("Helvetica-Bold").fontSize(12).text(banner, MARGIN + 8, at + 5, { width: width - 16 });
    doc.fillColor("#000");
    at += 24;
  }
  return at;
}

/** Label/value pairs, `columns` across, one line each (a long value is cut with an ellipsis). */
export function keyValueGrid(doc, pairs, { top, columns = 2, labelWidth = 72 }) {
  const colW = contentWidth(doc) / columns;
  doc.fontSize(9);
  pairs.forEach(([label, value], i) => {
    const x = MARGIN + (i % columns) * colW;
    const rowY = top + 4 + Math.floor(i / columns) * 14;
    doc.font("Helvetica-Bold").text(label, x, rowY, { width: labelWidth, lineBreak: false });
    doc.font("Helvetica").text(String(value), x + labelWidth + 2, rowY, { width: colW - labelWidth - 10, lineBreak: false, ellipsis: true });
  });
  doc.x = MARGIN;
  doc.y = top + 4 + Math.ceil(pairs.length / columns) * 14 + 6;
}

/** A ruled section heading; leaves the 9pt body font set. */
export function section(doc, title) {
  const width = contentWidth(doc);
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(11).text(title, MARGIN, doc.y, { width });
  doc.moveTo(MARGIN, doc.y + 1).lineTo(MARGIN + width, doc.y + 1).lineWidth(0.5).stroke();
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(9);
}

/** Body text at the left margin, full width (flows onto further pages). */
export function paragraph(doc, text) {
  doc.text(text, MARGIN, doc.y, { width: contentWidth(doc) });
}

/**
 * A table. `columns`: [{ label, width (fraction of the content width), align }];
 * `rows`: arrays of strings. Cells wrap; a row that won't fit starts a new
 * page, which repeats the header.
 */
export function table(doc, { columns, rows }) {
  const total = contentWidth(doc);
  const widths = columns.map((c) => c.width * total);
  const xs = widths.map((_, i) => MARGIN + widths.slice(0, i).reduce((s, w) => s + w, 0));
  const drawHeader = () => {
    drawRow(columns.map((c) => c.label), "Helvetica-Bold", false);
    doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + total, doc.y).lineWidth(0.5).stroke();
  };
  function drawRow(cells, font, repeatHeader) {
    doc.font(font).fontSize(9);
    const h = Math.max(...cells.map((c, i) => doc.heightOfString(String(c ?? ""), { width: widths[i] - 6 }))) + 4;
    if (doc.y + h > doc.page.height - MARGIN) {
      doc.addPage();
      if (repeatHeader) {
        drawHeader();
        doc.font(font).fontSize(9);
      }
    }
    const y = doc.y;
    cells.forEach((c, i) => doc.text(String(c ?? ""), xs[i] + 3, y + 2, { width: widths[i] - 6, align: columns[i].align ?? "left" }));
    doc.x = MARGIN;
    doc.y = y + h;
  }
  drawHeader();
  for (const r of rows) drawRow(r, "Helvetica", true);
}

/** Right-aligned label / amount lines under a table. */
export function totalsBlock(doc, rows) {
  const width = contentWidth(doc);
  doc.moveDown(0.4);
  for (const { label, value, bold } of rows) {
    const y = doc.y;
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9);
    doc.text(label, MARGIN + width * 0.5, y, { width: width * 0.32, align: "right" });
    doc.text(value, MARGIN + width * 0.82, y, { width: width * 0.18, align: "right" });
    doc.x = MARGIN;
  }
}

export function footer(doc, text) {
  doc.moveDown(1).font("Helvetica-Oblique").fontSize(7).fillColor("#444").text(text, MARGIN, doc.y, { width: contentWidth(doc) });
  doc.fillColor("#000");
}
