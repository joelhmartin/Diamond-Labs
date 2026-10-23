import { LAB_STATUS_LABELS, LAB_TIMEZONE, formatUsDate, formatLabDate } from "@my-app/shared";
import { deepPrintable } from "../pdf/pdf-text.js";

/**
 * Everything printed on a work ticket, decided here so it is testable — the
 * pdfkit renderer (ticket-pdf.js) only lays it out. Input is the lab order
 * detail (lab-orders.service getLabOrderDetail) plus the Rx answers grouped
 * as on the form (groupRxAnswers). The ticket carries PHI: it is built on
 * request and never stored.
 */

const ARCH = { upper: "Upper", lower: "Lower", both: "Both" };
const archLabel = (a) => (a ? (ARCH[String(a).toLowerCase()] ?? String(a)) : "");

// Dates print via the shared formatter; "—" when absent.
const usDate = (iso) => formatUsDate(iso) || "—";
const labDate = (instant) => formatLabDate(instant) || "—";
const labDateTime = (instant) => new Date(instant).toLocaleString("en-US", {
  timeZone: LAB_TIMEZONE, month: "2-digit", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit",
});

export function buildTicketModel(detail, { answerGroups = [], generatedAt }) {
  const { order, lines, rxCase, files = [], shopOrder, legacy = null } = detail;
  const banners = [];
  if (order.rush) banners.push(order.rushTier ? `RUSH — ${order.rushTier}` : "RUSH");
  if (order.isRemake) banners.push(order.remakeOfOrderNumber ? `REMAKE of #${order.remakeOfOrderNumber}` : "REMAKE");
  if (order.status === "on_hold") banners.push("ON HOLD");

  const ship = shopOrder?.shipping;
  const practice = rxCase?.practiceName || order.clientName || ship?.name || "—";
  const model = {
    title: `Work ticket #${order.orderNumber}`,
    orderNumber: String(order.orderNumber),
    barcodeText: String(order.orderNumber),
    banners,
    header: [
      ["Order", `#${order.orderNumber}`],
      rxCase ? ["Case", rxCase.caseNumber ?? "—"] : legacy ? ["Seazona order", legacy.seazonaOrderId] : ["Shop order", shopOrder?.orderNumber ?? "—"],
      ["Practice", practice],
      // A solo practice is named after its doctor; don't print the name twice.
      ...((order.clientName || "—") === practice ? [] : [["Doctor", order.clientName || "—"]]),
      ["Patient", rxCase?.patientName || legacy?.patientName || "—"],
      ["Received", labDate(order.receivedAt)],
      ["Due", usDate(order.dueDate)],
      ["Status", LAB_STATUS_LABELS[order.status] ?? order.status],
      ["Department", order.departmentName || "—"],
      ["Assigned to", order.assigneeName || "—"],
    ],
    lines: lines.filter((l) => !l.noteOnly).map((l) => ({
      qty: String(l.qty), code: l.code || "—", name: l.name, arch: archLabel(l.arch),
    })),
    instructions: lines.filter((l) => l.noteOnly).map((l) => l.sourceLabel || l.name),
    buildNotes: rxCase?.buildNotes || null,
    comments: rxCase?.generalComments || null,
    shipTo: ship
      ? [ship.name, ship.address1, `${ship.city ?? ""}, ${ship.state ?? ""} ${ship.postalCode ?? ""}`.trim()].filter(Boolean)
      : null,
    answerGroups: answerGroups.map((g) => ({ title: g.title, items: g.items.map((i) => [i.label, i.value]) })),
    files: files.map((f) => `${f.kind}: ${f.originalName || "unnamed"}`),
    footer: `Printed ${labDateTime(generatedAt)} · Contains patient information — keep with the case and shred when done.`,
  };
  return deepPrintable(model);
}
