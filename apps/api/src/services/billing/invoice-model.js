import { LAB_TIMEZONE, formatUsDate, formatLabDate, isoDateIn, invoiceStatusLabel } from "@my-app/shared";
import { formatCents } from "../../lib/money.js";
import { deepPrintable } from "../pdf/pdf-text.js";

const usDate = (iso) => formatUsDate(iso) || "—";
const labDate = (instant) => formatLabDate(instant) || "—";

/** Who the bill is for: practice, the doctor (when different), address, account. */
export function billToLines(client) {
  if (!client) return ["Walk-in / guest"];
  const practice = client.practice || client.name || "—";
  const cityLine = `${[client.city, client.state].filter(Boolean).join(", ")}${client.zip ? ` ${client.zip}` : ""}`.trim();
  return [
    practice,
    client.name && client.name !== practice ? client.name : null,
    client.address1 || null,
    client.address2 || null,
    cityLine || null,
    client.accountNumber ? `Account ${client.accountNumber}` : null,
  ].filter(Boolean);
}

/**
 * Everything printed on an invoice, decided here so it is testable; the
 * renderer (billing-pdf.js) only lays it out. The patient's name is printed
 * (the doctor needs it to match the bill). The PDF is generated on request,
 * never stored, and its filename never names the patient.
 *
 * @param invoice  from getInvoiceDetail (with paidCents / balanceCents)
 * @param order    getInvoiceDetail's labOrder block: { orderNumber, caseNumber, patientName, shopOrderNumber }
 */
export function buildInvoiceModel(invoice, lines, client, order, { generatedAt }) {
  const status = invoiceStatusLabel(invoice, isoDateIn(LAB_TIMEZONE, generatedAt));
  const banners = [];
  if (invoice.status === "draft") banners.push("DRAFT — NOT A BILL");
  if (invoice.status === "void") banners.push("VOID");
  const totals = [
    { label: "Subtotal", value: formatCents(invoice.subtotalCents) },
    ...(invoice.shippingCents ? [{ label: "Shipping", value: formatCents(invoice.shippingCents) }] : []),
    { label: "Tax", value: formatCents(invoice.taxCents) },
    { label: "Total", value: formatCents(invoice.totalCents), bold: true },
    ...(invoice.status === "issued"
      ? [{ label: "Paid", value: formatCents(invoice.paidCents) }, { label: "Balance due", value: formatCents(Math.max(0, invoice.balanceCents)), bold: true }]
      : []),
  ];
  return deepPrintable({
    title: `Invoice #${invoice.invoiceNumber}`,
    filename: `invoice-${invoice.invoiceNumber}.pdf`,
    invoiceNumber: String(invoice.invoiceNumber),
    status,
    banners,
    header: [
      ["Invoice", `#${invoice.invoiceNumber}`],
      ["Status", status],
      ["Issued", invoice.issuedAt ? labDate(invoice.issuedAt) : "—"],
      ["Due", usDate(invoice.dueDate)],
      order?.shopOrderNumber ? ["Shop order", order.shopOrderNumber] : ["Lab order", order?.orderNumber ? `#${order.orderNumber}` : "—"],
      ["Case", order?.caseNumber ?? "—"],
      ["Patient", order?.patientName ?? "—"],
    ],
    billTo: billToLines(client),
    lines: lines.map((l) => [String(l.qty), l.code || "—", l.description, formatCents(l.unitCents), formatCents(l.lineCents)]),
    totals,
    footer: `Generated ${labDate(generatedAt)} · Diamond Orthotic Laboratory · Pay online in the doctor portal. Contains patient information — keep confidential.`,
  });
}
