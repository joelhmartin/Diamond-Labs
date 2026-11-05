import { and, asc, eq, gte, lte, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { INVOICE_EXPORT_STATUSES, invoiceExportParamsSchema, isoDateIn, LAB_TIMEZONE } from "@my-app/shared";
import { doctorProfiles, invoices, invoicePayments, labOrders, users } from "../db/schema/index.js";
import { withBalances } from "../services/billing/ledger.service.js";

/**
 * The invoice export source: one row per invoice for the accountant (number,
 * client, dates, money). There is deliberately no patient column; a downloaded
 * file leaves the app's encryption and audit. Balances come from the ledger
 * (withBalances), never from a stored flag.
 */

const client = alias(users, "client");

const PARAMS = [
  {
    id: "dateField", label: "Date to filter on", type: "select", required: true,
    options: [
      { value: "ordered", label: "Order received" },
      { value: "issued", label: "Invoice issued" },
      { value: "due", label: "Due" },
    ],
  },
  { id: "from", label: "From", type: "date", required: true },
  { id: "to", label: "To", type: "date", required: true },
  {
    id: "statuses", label: "Status", type: "multiselect",
    options: [
      { value: "open", label: "Open" },
      { value: "paid", label: "Paid" },
      { value: "void", label: "Void" },
      { value: "draft", label: "Draft" },
    ],
  },
];

const FIELDS = [
  { key: "invoiceNumber", label: "Invoice #", type: "int" },
  { key: "kind", label: "Kind", type: "text" },
  { key: "status", label: "Status", type: "text" },
  { key: "accountNumber", label: "Account #", type: "text" },
  { key: "practice", label: "Practice", type: "text" },
  { key: "clientName", label: "Client", type: "text" },
  { key: "orderNumber", label: "Order #", type: "int" },
  { key: "orderedOn", label: "Ordered", type: "date" },
  { key: "issuedOn", label: "Issued", type: "date" },
  { key: "dueOn", label: "Due", type: "date" },
  { key: "subtotal", label: "Subtotal", type: "cents" },
  { key: "tax", label: "Tax", type: "cents" },
  { key: "shipping", label: "Shipping", type: "cents" },
  { key: "total", label: "Total", type: "cents" },
  { key: "paid", label: "Paid", type: "cents" },
  { key: "balance", label: "Balance", type: "cents" },
];

// Same sum withBalances uses, as a correlated subquery so a status filter
// never loads the ledger. The displayed paid/balance still come from withBalances.
const paidSql = sql`(select coalesce(sum(${invoicePayments.appliedCents}), 0) from ${invoicePayments} where ${invoicePayments.invoiceId} = ${invoices.id})`;

function statusCondition(statuses) {
  if (!statuses?.length) return ne(invoices.status, "draft");
  if (new Set(statuses).size === INVOICE_EXPORT_STATUSES.length) return undefined;
  const parts = statuses.map((s) => {
    if (s === "open") return and(eq(invoices.status, "issued"), sql`${invoices.totalCents} - ${paidSql} > 0`);
    if (s === "paid") return and(eq(invoices.status, "issued"), sql`${invoices.totalCents} - ${paidSql} <= 0`);
    return eq(invoices.status, s);
  });
  return parts.length === 1 ? parts[0] : or(...parts);
}

/** The window is whole lab-local days: [from 00:00, to + 1 day 00:00) in LAB_TIMEZONE. */
function instantWindow(ts, { from, to }) {
  return and(
    sql`${ts} >= (${from}::date)::timestamp at time zone ${LAB_TIMEZONE}`,
    sql`${ts} < ((${to}::date + 1)::timestamp) at time zone ${LAB_TIMEZONE}`
  );
}

function dateCondition({ dateField, from, to }) {
  if (dateField === "due") return and(gte(invoices.dueDate, from), lte(invoices.dueDate, to));
  const ts = dateField === "issued" ? sql`${invoices.issuedAt}` : sql`coalesce(${labOrders.receivedAt}, ${invoices.issuedAt})`;
  return instantWindow(ts, { from, to });
}

const whereFor = (params) => and(dateCondition(params), statusCondition(params.statuses));

const labDay = (instant) => (instant ? isoDateIn(LAB_TIMEZONE, new Date(instant)) : null);

function present({ invoice, clientName, practice, accountNumber, orderNumber, receivedAt }) {
  const settled = invoice.status === "void" ? "void" : invoice.status === "draft" ? "draft" : invoice.paid ? "paid" : "open";
  return {
    invoiceNumber: invoice.invoiceNumber, kind: invoice.kind, status: settled,
    accountNumber: accountNumber ?? null, practice: practice ?? null, clientName: clientName ?? null,
    orderNumber: orderNumber ?? null,
    orderedOn: labDay(receivedAt ?? invoice.issuedAt), issuedOn: labDay(invoice.issuedAt), dueOn: invoice.dueDate ?? null,
    subtotal: invoice.subtotalCents, tax: invoice.taxCents, shipping: invoice.shippingCents, total: invoice.totalCents,
    paid: invoice.paidCents, balance: invoice.balanceCents,
  };
}

function fromJoins(query) {
  return query
    .from(invoices)
    .leftJoin(client, eq(client.id, invoices.clientUserId))
    .leftJoin(doctorProfiles, eq(doctorProfiles.userId, invoices.clientUserId))
    .leftJoin(labOrders, eq(labOrders.id, invoices.labOrderId));
}

export const invoicesSource = {
  key: "invoices",
  label: "Invoices",
  params: PARAMS,
  paramsSchema: invoiceExportParamsSchema,
  fields: FIELDS,

  async fetchPage(db, params, { limit, offset }) {
    const where = whereFor(params);
    const rows = await fromJoins(
      db.select({
        invoice: invoices, clientName: client.name, accountNumber: client.seazonaAccountNumber,
        practice: doctorProfiles.companyName,
        orderNumber: labOrders.orderNumber, receivedAt: labOrders.receivedAt,
      })
    )
      .where(where)
      .orderBy(asc(invoices.invoiceNumber))
      .limit(limit)
      .offset(offset);
    const [{ n }] = await fromJoins(db.select({ n: sql`count(*)`.mapWith(Number) })).where(where);
    const balanced = await withBalances(rows.map((r) => r.invoice), db);
    return { rows: rows.map((r, i) => present({ ...r, invoice: balanced[i] })), total: n };
  },
};
