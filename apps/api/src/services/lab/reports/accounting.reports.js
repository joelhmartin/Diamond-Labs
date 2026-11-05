/**
 * Accounting (9 reports, admin only). Receivables and statements come from the
 * billing services' own rules (listReceivables → buildReceivables, the
 * statement model's events, deriveBalance); the rest are grouped queries on
 * the shared definitions in lab-metrics.js.
 */
import { sql } from "drizzle-orm";
import {
  AGING_BUCKETS, CREDIT_SOURCE, INVOICE_KIND_LABELS, INVOICE_STATUS_LABELS, LEGACY_SETTLEMENT_SOURCE,
  PAYMENT_SOURCE_LABELS, invoiceStatusLabel,
} from "@my-app/shared";
import { invoices, invoiceLines, invoicePayments } from "../../../db/schema/index.js";
import { listReceivables, loadStatementActivity, loadClientNames } from "../../billing/statements.service.js";
import { statementEvents, monthBounds } from "../../billing/statement-model.js";
import { deriveBalance } from "../../billing/invoice-rules.js";
import {
  CLIENT_LINK, INVOICE_LINK, clientLabel, discountNotices, clientName, isDiscountLine, labDayBetween, labDayText, labMonthText, labToday, num, orderAndPage,
  paymentDay, paymentDayBetween, rowsOf, salesWhere,
} from "./lab-metrics.js";
import { ADMIN, money, optionalClientJoin, sumOf, sums } from "./report-helpers.js";

const GROUP = "accounting";

const RANGE = { name: "range", label: "Dates", type: "dateRange", default: "last30", maxDays: 1100 };
const CLIENT = { name: "client", label: "Client", type: "lookup", source: "client" };
const clientCol = { id: "client", label: "Client", type: "text", link: CLIENT_LINK };
const invoiceCol = { id: "invoiceNumber", label: "Invoice", type: "text", link: INVOICE_LINK };
const invoiceNo = (v) => (v === null || v === undefined ? null : String(v));

const AGING_COLUMNS = AGING_BUCKETS.map((b) => money(b.key, b.label));

const accountBalance = {
  key: "accounting.account-balance", group: GROUP, roles: ADMIN, title: "Account Balance",
  description: "What each client owes today: open issued invoices, the past-due part and the oldest due date.",
  columns: [
    clientCol, { id: "accountNumber", label: "Account", type: "text" }, { id: "openInvoices", label: "Open invoices", type: "int" },
    money("pastDue", "Past due"), money("balance", "Balance"), { id: "oldestDue", label: "Oldest due", type: "date" },
  ],
  async run(tx, _params, _actor, ctx) {
    const ar = await listReceivables({}, tx, { today: labToday(ctx) });
    const rows = ar.rows.map((r) => ({
      clientUserId: r.clientUserId, client: clientLabel(r), accountNumber: r.accountNumber, openInvoices: r.openInvoices,
      pastDue: r.pastDueCents, balance: r.balanceCents, oldestDue: r.oldestDueDate,
    }));
    return { rows, summary: { openInvoices: sumOf(rows, "openInvoices"), pastDue: ar.totals.pastDueCents, balance: ar.totals.balanceCents }, notice: `As of ${ar.asOf}.` };
  },
};

const agingSummary = {
  key: "accounting.aging-summary", group: GROUP, roles: ADMIN, title: "Aging Summary",
  description: "Open balances per client by days past due, with totals.",
  params: [{ name: "pastDueOnly", label: "Past due only", type: "toggle", default: false }],
  columns: [clientCol, { id: "accountNumber", label: "Account", type: "text" }, ...AGING_COLUMNS, money("balance", "Total")],
  async run(tx, params, _actor, ctx) {
    const ar = await listReceivables({ pastDueOnly: Boolean(params?.pastDueOnly) }, tx, { today: labToday(ctx) });
    const rows = ar.rows.map((r) => ({ clientUserId: r.clientUserId, client: clientLabel(r), accountNumber: r.accountNumber, ...r.buckets, balance: r.balanceCents }));
    return { rows, summary: { ...ar.totals.buckets, balance: ar.totals.balanceCents }, notice: `As of ${ar.asOf}.` };
  },
};

const adjustments = {
  key: "accounting.adjustments", group: GROUP, roles: ADMIN, title: "Adjustments",
  description: "Adjustment lines on issued invoices (by issue day) and staff credits (by the day applied). Negative amounts reduce what the client owes.",
  params: [RANGE],
  columns: [
    { id: "day", label: "Date", type: "date" }, { id: "type", label: "Type", type: "text" }, invoiceCol, clientCol,
    { id: "description", label: "Description", type: "text" }, money("amount", "Amount"),
  ],
  async run(tx, { range }) {
    const raw = await rowsOf(tx, sql`
      select 'Adjustment' as "type", ${labDayText(invoices.issuedAt)} as "day", ${invoices.id} as "invoiceId", ${invoices.invoiceNumber} as "invoiceNumber",
        ${invoices.clientUserId} as "clientUserId", ${clientName} as "client", ${invoiceLines.description} as "description", ${invoiceLines.lineCents} as "amount"
      from ${invoiceLines} join ${invoices} on ${invoices.id} = ${invoiceLines.invoiceId} ${optionalClientJoin(invoices.clientUserId)}
      where ${invoiceLines.kind} = 'adjustment' and ${salesWhere(range)}
      union all
      select 'Credit', to_char(${paymentDay}, 'YYYY-MM-DD'), ${invoices.id}, ${invoices.invoiceNumber},
        ${invoices.clientUserId}, ${clientName}, null, -${invoicePayments.appliedCents}
      from ${invoicePayments} join ${invoices} on ${invoices.id} = ${invoicePayments.invoiceId} ${optionalClientJoin(invoices.clientUserId)}
      where ${invoicePayments.source} = ${CREDIT_SOURCE} and ${paymentDayBetween(range)}
      order by 2, 4, 1`);
    const rows = raw.map((r) => ({ ...r, invoiceNumber: invoiceNo(r.invoiceNumber), amount: num(r.amount) }));
    return { rows, summary: { amount: sumOf(rows, "amount") } };
  },
};

const discounts = {
  key: "accounting.discounts", group: GROUP, roles: ADMIN, title: "Discounts",
  description: "Negative adjustment lines on issued invoices, by issue day.",
  params: [RANGE],
  columns: [{ id: "day", label: "Date", type: "date" }, invoiceCol, clientCol, { id: "description", label: "Description", type: "text" }, money("amount", "Amount")],
  async run(tx, { range }) {
    const raw = await rowsOf(tx, sql`
      select ${labDayText(invoices.issuedAt)} as "day", ${invoices.id} as "invoiceId", ${invoices.invoiceNumber} as "invoiceNumber",
        ${invoices.clientUserId} as "clientUserId", ${clientName} as "client", ${invoiceLines.description} as "description", ${invoiceLines.lineCents} as "amount"
      from ${invoiceLines} join ${invoices} on ${invoices.id} = ${invoiceLines.invoiceId} ${optionalClientJoin(invoices.clientUserId)}
      where ${isDiscountLine} and ${salesWhere(range)}
      order by 1, ${invoices.invoiceNumber}, ${invoiceLines.position}`);
    const rows = raw.map((r) => ({ ...r, invoiceNumber: invoiceNo(r.invoiceNumber), amount: num(r.amount) }));
    return { rows, summary: { amount: sumOf(rows, "amount") }, notice: discountNotices(range) };
  },
};

/** Drafts have no issue date: they are listed by the day they were started. */
const invoiceDate = sql`coalesce(${invoices.issuedAt}, ${invoices.createdAt})`;
const STATUS_OPTIONS = [{ value: "all", label: "All" }, ...Object.entries(INVOICE_STATUS_LABELS).map(([value, label]) => ({ value, label }))];

const invoicesList = {
  key: "accounting.invoices", group: GROUP, roles: ADMIN, title: "Invoices", paging: "server",
  description: "Every invoice by issue date (drafts by the day started), status and client.",
  params: [RANGE, { name: "status", label: "Status", type: "select", options: STATUS_OPTIONS, default: "all" }, CLIENT],
  columns: [
    invoiceCol, { id: "day", label: "Date", type: "date" }, { id: "status", label: "Status", type: "text" }, { id: "kind", label: "Kind", type: "text" },
    clientCol, money("subtotal", "Subtotal"), money("tax", "Tax"), money("shipping", "Shipping"), money("total", "Total"),
    { id: "dueDate", label: "Due", type: "date" },
  ],
  async run(tx, params, _actor, ctx) {
    const { range, status = "all", client } = params;
    const where = sql.join([
      labDayBetween(invoiceDate, range),
      status !== "all" ? sql`${invoices.status} = ${status}` : undefined,
      client ? sql`${invoices.clientUserId} = ${client}` : undefined,
    ].filter(Boolean), sql` and `);
    const sorts = {
      invoiceNumber: invoices.invoiceNumber, day: invoiceDate, status: invoices.status, kind: invoices.kind, client: clientName,
      subtotal: invoices.subtotalCents, tax: invoices.taxCents, shipping: invoices.shippingCents, total: invoices.totalCents, dueDate: invoices.dueDate,
    };
    const [count] = await rowsOf(tx, sql`select count(*) as "total" from ${invoices} where ${where}`);
    const raw = await rowsOf(tx, sql`
      select ${invoices.id} as "id", ${invoices.invoiceNumber} as "invoiceNumber", ${labDayText(invoiceDate)} as "day", ${invoices.status} as "status",
        ${invoices.kind} as "kind", ${invoices.clientUserId} as "clientUserId", ${clientName} as "client",
        ${invoices.subtotalCents} as "subtotal", ${invoices.taxCents} as "tax", ${invoices.shippingCents} as "shipping", ${invoices.totalCents} as "total",
        to_char(${invoices.dueDate}, 'YYYY-MM-DD') as "dueDate"
      from ${invoices} ${optionalClientJoin(invoices.clientUserId)}
      where ${where} ${orderAndPage(ctx?.page, sorts, { id: "day", desc: true }, invoices.id)}`);
    const rows = raw.map((r) => ({
      invoiceId: r.id, invoiceNumber: invoiceNo(r.invoiceNumber), day: r.day, status: INVOICE_STATUS_LABELS[r.status] ?? r.status,
      kind: INVOICE_KIND_LABELS[r.kind] ?? r.kind, clientUserId: r.clientUserId, client: r.client ?? "No client",
      subtotal: num(r.subtotal), tax: num(r.tax), shipping: num(r.shipping), total: num(r.total), dueDate: r.dueDate,
    }));
    return { rows, total: num(count?.total) };
  },
};

const SUMMARY_BY = [{ value: "day", label: "Day" }, { value: "month", label: "Month" }, { value: "client", label: "Client" }];

const invoicesSummary = {
  key: "accounting.invoices-summary", group: GROUP, roles: ADMIN, title: "Invoices Summary",
  description: "Issued invoices counted and totalled by day, month or client (the sales rule: no drafts, voids or opening balances).",
  params: [RANGE, { name: "by", label: "Group by", type: "select", options: SUMMARY_BY, default: "month" }],
  columns: [
    { id: "bucket", label: "Day, month or client", type: "text", link: CLIENT_LINK }, { id: "invoices", label: "Invoices", type: "int" },
    money("subtotal", "Subtotal"), money("tax", "Tax"), money("shipping", "Shipping"), money("total", "Total"),
  ],
  async run(tx, { range, by = "month" }) {
    const bucket = {
      day: sql`${labDayText(invoices.issuedAt)}`,
      month: labMonthText(invoices.issuedAt),
      client: sql`coalesce(${clientName}, 'No client')`,
    }[by] ?? labMonthText(invoices.issuedAt);
    const clientId = by === "client" ? sql`${invoices.clientUserId}` : sql`null`;
    const raw = await rowsOf(tx, sql`
      select ${bucket} as "bucket", ${clientId} as "clientUserId", count(*) as "invoices", sum(${invoices.subtotalCents}) as "subtotal",
        sum(${invoices.taxCents}) as "tax", sum(${invoices.shippingCents}) as "shipping", sum(${invoices.totalCents}) as "total"
      from ${invoices} ${optionalClientJoin(invoices.clientUserId)}
      where ${salesWhere(range)}
      group by 1, 2 order by ${by === "client" ? sql`4 desc, 1, 2` : sql`1`}`);
    const ids = ["invoices", "subtotal", "tax", "shipping", "total"];
    const rows = raw.map((r) => ({ bucket: r.bucket, clientUserId: r.clientUserId ?? null, ...Object.fromEntries(ids.map((k) => [k, num(r[k])])) }));
    return { rows, summary: sums(rows, ids) };
  },
};

/** Paid and last payment per invoice from the ledger (paid includes credits and refunds, as everywhere). */
const ledgerTotals = sql`(
  select ${invoicePayments.invoiceId} as invoice_id, sum(${invoicePayments.appliedCents}) as paid,
    max(case when ${invoicePayments.appliedCents} > 0 then ${paymentDay} end) as last_paid
  from ${invoicePayments} where ${invoicePayments.invoiceId} is not null group by 1
) ledger`;

const invoicesPayments = {
  key: "accounting.invoices-payments", group: GROUP, roles: ADMIN, title: "Invoices & Payments", paging: "server",
  description: "Each issued invoice with what has been paid, the balance and the last payment date.",
  params: [RANGE, CLIENT],
  columns: [
    invoiceCol, { id: "day", label: "Issued", type: "date" }, clientCol, { id: "status", label: "Status", type: "text", sortable: false },
    money("total", "Total"), money("paid", "Paid"), money("balance", "Balance"), { id: "lastPaid", label: "Last payment", type: "date" },
  ],
  async run(tx, { range, client }, _actor, ctx) {
    const where = sql.join([
      sql`${invoices.status} = 'issued'`, labDayBetween(invoices.issuedAt, range), client ? sql`${invoices.clientUserId} = ${client}` : undefined,
    ].filter(Boolean), sql` and `);
    const paid = sql`coalesce(ledger.paid, 0)`;
    const sorts = {
      invoiceNumber: invoices.invoiceNumber, day: invoices.issuedAt, client: clientName,
      total: invoices.totalCents, paid, balance: sql`${invoices.totalCents} - ${paid}`, lastPaid: sql`ledger.last_paid`,
    };
    const [count] = await rowsOf(tx, sql`select count(*) as "total" from ${invoices} where ${where}`);
    const raw = await rowsOf(tx, sql`
      select ${invoices.id} as "id", ${invoices.invoiceNumber} as "invoiceNumber", ${labDayText(invoices.issuedAt)} as "day", ${invoices.status} as "status",
        to_char(${invoices.dueDate}, 'YYYY-MM-DD') as "dueDate", ${invoices.clientUserId} as "clientUserId", ${clientName} as "client",
        ${invoices.totalCents} as "total", ${paid} as "paid", to_char(ledger.last_paid, 'YYYY-MM-DD') as "lastPaid"
      from ${invoices} left join ${ledgerTotals} on ledger.invoice_id = ${invoices.id} ${optionalClientJoin(invoices.clientUserId)}
      where ${where} ${orderAndPage(ctx?.page, sorts, { id: "day", desc: true }, invoices.id)}`);
    const today = labToday(ctx);
    const rows = raw.map((r) => {
      const b = deriveBalance({ status: r.status, totalCents: num(r.total) }, num(r.paid));
      return {
        invoiceId: r.id, invoiceNumber: invoiceNo(r.invoiceNumber), day: r.day, clientUserId: r.clientUserId, client: r.client ?? "No client",
        status: invoiceStatusLabel({ status: r.status, balanceCents: b.balanceCents, dueDate: r.dueDate }, today),
        total: num(r.total), paid: b.paidCents, balance: b.balanceCents, lastPaid: r.lastPaid ?? null,
      };
    });
    return { rows, total: num(count?.total) };
  },
};

const CARD = ["doctor_card", "doctor_hosted", "admin_card", "shop_card"];
const MANUAL = ["admin_check", "admin_cash", "admin_ach", "admin_other", "admin_offline"];
const SOURCE_FILTERS = { card: CARD, autopay: ["autopay"], manual: MANUAL };
const SOURCE_OPTIONS = [
  { value: "all", label: "All" }, { value: "card", label: "Card" }, { value: "autopay", label: "AutoPay" }, { value: "manual", label: "Check, cash, ACH, other" },
];
/**
 * Sort key for an invoice number held as text (an imported ledger row keeps
 * Seazona's): zero-padded, so numbers order numerically and anything else
 * still orders deterministically.
 */
const numberSort = (textExpr) => sql`lpad(${textExpr}, 20, '0')`;
/** The method label as shown (PAYMENT_SOURCE_LABELS), so sorting matches the screen. */
const sourceLabelSql = sql`case ${invoicePayments.source} ${sql.join(
  Object.entries(PAYMENT_SOURCE_LABELS).map(([k, v]) => sql`when ${k} then ${v}`), sql` `,
)} else 'Unknown' end`;
const inList = (values) => sql.join(values.map((v) => sql`${v}`), sql`, `);

const paymentsReceived = {
  key: "accounting.payments-received", group: GROUP, roles: ADMIN, title: "Payments Received", paging: "server",
  description: "Money received, one ledger row per invoice paid, by the day received. Refunds, credits and Seazona settlements are not payments and are left out.",
  params: [RANGE, { name: "source", label: "Method", type: "select", options: SOURCE_OPTIONS, default: "all" }, CLIENT],
  columns: [
    { id: "day", label: "Received", type: "date" }, clientCol, invoiceCol, { id: "sourceLabel", label: "Method", type: "text" },
    { id: "reference", label: "Reference", type: "text" }, money("amount", "Amount"),
  ],
  async run(tx, { range, source = "all", client }, _actor, ctx) {
    const payer = sql`coalesce(${invoices.clientUserId}, ${invoicePayments.userId})`;
    const where = sql.join([
      sql`${invoicePayments.appliedCents} > 0`,
      sql`coalesce(${invoicePayments.source}, '') not in (${inList([CREDIT_SOURCE, LEGACY_SETTLEMENT_SOURCE])})`,
      paymentDayBetween(range),
      SOURCE_FILTERS[source] ? sql`${invoicePayments.source} in (${inList(SOURCE_FILTERS[source])})` : undefined,
      client ? sql`${payer} = ${client}` : undefined,
    ].filter(Boolean), sql` and `);
    const from = sql`from ${invoicePayments} left join ${invoices} on ${invoices.id} = ${invoicePayments.invoiceId} ${optionalClientJoin(payer)}`;
    const number = sql`coalesce(${invoices.invoiceNumber}::text, ${invoicePayments.invoiceNumber})`;
    const sorts = {
      day: paymentDay, client: clientName, invoiceNumber: numberSort(number), sourceLabel: sourceLabelSql,
      reference: invoicePayments.reference, amount: invoicePayments.appliedCents,
    };
    const [count] = await rowsOf(tx, sql`select count(*) as "total", coalesce(sum(${invoicePayments.appliedCents}), 0) as "cents" ${from} where ${where}`);
    const raw = await rowsOf(tx, sql`
      select ${invoicePayments.id} as "id", to_char(${paymentDay}, 'YYYY-MM-DD') as "day", ${invoicePayments.source} as "source",
        ${invoicePayments.reference} as "reference", ${invoicePayments.invoiceId} as "invoiceId", ${number} as "invoiceNumber",
        ${payer} as "clientUserId", ${clientName} as "client", ${invoicePayments.appliedCents} as "amount"
      ${from} where ${where} ${orderAndPage(ctx?.page, sorts, { id: "day", desc: true }, invoicePayments.id)}`);
    const rows = raw.map((r) => ({
      day: r.day, clientUserId: r.clientUserId, client: r.client, invoiceId: r.invoiceId, invoiceNumber: invoiceNo(r.invoiceNumber),
      sourceLabel: PAYMENT_SOURCE_LABELS[r.source] ?? "Unknown", reference: r.reference ?? null, amount: num(r.amount),
    }));
    return { rows, total: num(count?.total), summary: { amount: num(count?.cents) } };
  },
};

/** The month before the run's lab day, as any day in it. */
function lastMonthDay(ctx) {
  const [y, m] = labToday(ctx).split("-").map(Number);
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
}

/**
 * Per client for one month: opening, invoiced, paid and closing, from the
 * statement's own events (statement-model.js), so it always agrees with the
 * statements staff send. Invoiced is net of voids; paid is payments, credits
 * and settlements net of refunds. closing = opening + invoiced − paid.
 */
function summarizeStatements(activity, { startIso, endIso }) {
  const clientOf = new Map(activity.invoices.map((i) => [i.id, i.clientUserId]));
  const per = new Map();
  for (const e of statementEvents(activity)) {
    if (e.date > endIso) continue;
    const id = clientOf.get(e.invoiceId);
    if (!id) continue;
    if (!per.has(id)) per.set(id, { opening: 0, invoiced: 0, paid: 0, active: false });
    const p = per.get(id);
    if (e.date < startIso) p.opening += e.amountCents;
    else if (e.kind === "invoice" || e.kind === "void") { p.invoiced += e.amountCents; p.active = true; }
    else { p.paid -= e.amountCents; p.active = true; }
  }
  return per;
}

const statementsSummary = {
  key: "accounting.statements-summary", group: GROUP, roles: ADMIN, title: "Statements Summary",
  description: "Per client for one month: opening balance, invoiced, paid and closing balance, as the statements show them.",
  params: [{ name: "month", label: "Month (any day in it; default last month)", type: "date" }],
  columns: [
    clientCol, { id: "accountNumber", label: "Account", type: "text" }, money("opening", "Opening"), money("invoiced", "Invoiced"),
    money("paid", "Paid"), money("closing", "Closing"),
  ],
  async run(tx, params, _actor, ctx) {
    const bounds = monthBounds((params?.month ?? lastMonthDay(ctx)).slice(0, 7));
    const activity = await loadStatementActivity(null, tx, { through: bounds.endIso });
    const per = summarizeStatements(activity, bounds);
    const names = await loadClientNames([...per.keys()], tx);
    const rows = [...per.entries()]
      .filter(([, p]) => p.active || p.opening !== 0)
      .map(([clientUserId, p]) => ({
        clientUserId, client: clientLabel(names.get(clientUserId)), accountNumber: names.get(clientUserId)?.accountNumber ?? null,
        opening: p.opening, invoiced: p.invoiced, paid: p.paid, closing: p.opening + p.invoiced - p.paid,
      }))
      .sort((a, b) => String(a.client ?? "").localeCompare(String(b.client ?? "")) || a.clientUserId.localeCompare(b.clientUserId));
    return { rows, summary: sums(rows, ["opening", "invoiced", "paid", "closing"]), notice: `Statement month: ${bounds.label}.` };
  },
};

export const ACCOUNTING_REPORTS = [
  accountBalance, adjustments, agingSummary, discounts, invoicesList, invoicesSummary, invoicesPayments, paymentsReceived, statementsSummary,
];

export function registerAccountingReports(registry) {
  for (const def of ACCOUNTING_REPORTS) registry.defineReport(def);
}
