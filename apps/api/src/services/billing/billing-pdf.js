import { renderPdf, titleBlock, banners, keyValueGrid, section, paragraph, table, totalsBlock, footer } from "../pdf/pdf-layout.js";

/** Lay out invoice and statement models (invoice-model.js, statement-model.js) on the shared PDF layer. */

const LINE_COLUMNS = [
  { label: "Qty", width: 0.07, align: "right" },
  { label: "Code", width: 0.1 },
  { label: "Description", width: 0.53 },
  { label: "Unit", width: 0.15, align: "right" },
  { label: "Amount", width: 0.15, align: "right" },
];

export function renderInvoicePdf(model) {
  return renderPdf(model.title, (doc) => {
    const y = banners(doc, model.banners, titleBlock(doc, { title: model.title, caption: "DIAMOND ORTHOTIC LABORATORY" }));
    keyValueGrid(doc, model.header, { top: y });
    section(doc, "Bill to");
    paragraph(doc, model.billTo.join("\n"));
    section(doc, "Items");
    table(doc, { columns: LINE_COLUMNS, rows: model.lines });
    totalsBlock(doc, model.totals);
    footer(doc, model.footer);
  });
}

const ACTIVITY_COLUMNS = [
  { label: "Date", width: 0.14 },
  { label: "Activity", width: 0.56 },
  { label: "Amount", width: 0.15, align: "right" },
  { label: "Balance", width: 0.15, align: "right" },
];

export function renderStatementPdf(model) {
  return renderPdf(model.title, (doc) => {
    const y = titleBlock(doc, { title: model.title, caption: "DIAMOND ORTHOTIC LABORATORY · ACCOUNT STATEMENT" });
    keyValueGrid(doc, model.summary, { top: y, labelWidth: 96 });
    section(doc, "Bill to");
    paragraph(doc, model.billTo.join("\n"));
    section(doc, "Activity");
    if (model.lines.length === 0) paragraph(doc, "No activity this month.");
    else table(doc, { columns: ACTIVITY_COLUMNS, rows: model.lines.map((l) => l.cells) });
    section(doc, "Aging of the closing balance");
    const width = 1 / model.aging.cells.length;
    table(doc, {
      columns: model.aging.cells.map(([label]) => ({ label, width, align: "right" })),
      rows: [model.aging.cells.map(([, value]) => value)],
    });
    footer(doc, model.footer);
  });
}
