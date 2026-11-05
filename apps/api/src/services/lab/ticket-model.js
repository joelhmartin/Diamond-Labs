import { LAB_STATUS_LABELS, LAB_ORDER_SOURCE_LABELS, LAB_TIMEZONE, formatUsDate, formatLabDate } from "@my-app/shared";
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

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** "DUE WED 11/12" for the slip; the weekday comes from the date's own parts, never the local zone. */
function dueBadgeFor(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return `DUE ${WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]} ${m[2]}/${m[3]}`;
}

export function buildTicketModel(detail, { answerGroups = [], generatedAt }) {
  const { order, lines, rxCase, files = [], shopOrder, legacy = null, schedule = null, staff = null } = detail;
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
    dueBadge: dueBadgeFor(order.dueDate),
    banners,
    header: [
      ["Order", `#${order.orderNumber}`],
      rxCase ? ["Case", rxCase.caseNumber ?? "—"]
        : legacy ? ["Seazona order", legacy.seazonaOrderId]
        : staff ? ["Entry", LAB_ORDER_SOURCE_LABELS.staff]
        : ["Shop order", shopOrder?.orderNumber ?? "—"],
      ["Practice", practice],
      // A solo practice is named after its doctor; don't print the name twice.
      ...((order.clientName || "—") === practice ? [] : [["Doctor", order.clientName || "—"]]),
      ["Patient", rxCase?.patientName || legacy?.patientName || staff?.patientName || "—"],
      ["Received", labDate(order.receivedAt)],
      ["Due", usDate(order.dueDate)],
      ...(schedule?.workflowName ? [["Workflow", schedule.workflowName]] : []),
      ["Status", LAB_STATUS_LABELS[order.status] ?? order.status],
      ["Department", order.departmentName || "—"],
      ["Assigned to", order.assigneeName || "—"],
    ],
    lines: lines.filter((l) => !l.noteOnly).map((l) => ({
      qty: String(l.qty), code: l.code || "—", name: l.name, arch: archLabel(l.arch),
    })),
    // The saved plan's stages, tick = milestone reached; empty without a plan.
    schedule: (schedule?.stages ?? []).map((st) => ({ label: st.label, target: usDate(st.targetAt), reached: Boolean(st.reached) })),
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
