/**
 * Sales (7 of the audit's 8; Sales By Rep waits for piece 6's client tags).
 * Admin only. Every figure is the one sales rule in lab-metrics.js: issued
 * invoices' subtotal by lab-local issue day.
 */
import { sql } from "drizzle-orm";
import { INVOICE_KINDS, INVOICE_KIND_LABELS, LAB_TIMEZONE, isoDateIn } from "@my-app/shared";
import { invoices, invoiceLines, productFamilies, users, doctorProfiles } from "../../../db/schema/index.js";
import {
  CLIENT_LINK, catalogJoins, clientName, coverageNotice, discountNotices, labDayText, num, orderAndPage, rowsOf, salesBreakdown, salesByDay, salesByMonth, salesWhere,
} from "./lab-metrics.js";

const ADMIN = ["admin"];
const GROUP = "sales";
const RANGE = { name: "range", label: "Dates", type: "dateRange", default: "last30", maxDays: 1100 };
const money = (id, label, extra = {}) => ({ id, label, type: "money", ...extra });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const share = (part, whole) => (whole ? part / whole : 0);

const comparison = {
  key: "sales.comparison", group: GROUP, roles: ADMIN, featured: true, title: "Sales Comparison",
  description: "Monthly sales for a year and the two before it.",
  params: [{ name: "year", label: "Year (default this year)", type: "number", min: 2000, max: 2100 }],
  columns: [
    { id: "month", label: "Month", type: "text", sortable: false },
    money("y2", "Two years before"), money("y1", "Year before"), money("y0", "Selected year"),
  ],
  chart: {
    type: "groupedBar", x: "month",
    series: [{ field: "y2", label: "Two years before" }, { field: "y1", label: "Year before" }, { field: "y0", label: "Selected year" }],
  },
  async run(tx, params) {
    const year = Number.isInteger(params?.year) ? params.year : Number(isoDateIn(LAB_TIMEZONE, new Date()).slice(0, 4));
    const byMonth = new Map((await salesByMonth(tx, { from: `${year - 2}-01-01`, to: `${year}-12-31` })).map((m) => [m.month, m.cents]));
    const cents = (y, i) => byMonth.get(`${y}-${String(i + 1).padStart(2, "0")}`) ?? 0;
    const rows = MONTHS.map((month, i) => ({ month, y2: cents(year - 2, i), y1: cents(year - 1, i), y0: cents(year, i) }));
    const total = (k) => rows.reduce((s, r) => s + r[k], 0);
    return { rows, summary: { month: "Total", y2: total("y2"), y1: total("y1"), y0: total("y0") }, notice: `Comparing ${year - 2}, ${year - 1} and ${year}.` };
  },
};

const summary = {
  key: "sales.summary", group: GROUP, roles: ADMIN, featured: true, title: "Sales Summary",
  description: "Gross, discounts, net sales, tax, shipping and total for the range and the period before it. Net is the sales figure.",
  params: [RANGE],
  columns: [
    { id: "period", label: "Period", type: "text" }, { id: "from", label: "From", type: "date" }, { id: "to", label: "To", type: "date" },
    { id: "invoices", label: "Invoices", type: "int" }, money("gross", "Gross"), money("discount", "Discounts"), money("net", "Net sales"),
    money("tax", "Tax"), money("shipping", "Shipping"), money("total", "Total billed"),
  ],
  async run(tx, { range }) {
    const row = async (period, r) => {
      const b = await salesBreakdown(tx, r);
      return {
        period, from: r.from, to: r.to, invoices: b.invoices, gross: b.grossCents, discount: b.discountCents, net: b.netCents,
        tax: b.taxCents, shipping: b.shippingCents, total: b.totalCents,
      };
    };
    const rows = [await row("This period", range)];
    if (range.previous) rows.push(await row("Previous period", range.previous));
    return { rows, notice: discountNotices({ from: range.previous?.from ?? range.from }) };
  },
};

const daily = {
  key: "sales.daily", group: GROUP, roles: ADMIN, title: "Daily Sales",
  description: "Sales per day.",
  params: [{ ...RANGE, maxDays: 366 }],
  columns: [{ id: "day", label: "Day", type: "date" }, { id: "invoices", label: "Invoices", type: "int" }, money("sales", "Sales")],
  chart: { type: "bar", x: "day", series: [{ field: "sales", label: "Sales" }] },
  async run(tx, { range }) {
    const rows = (await salesByDay(tx, range)).map((d) => ({ day: d.day, invoices: d.invoices, sales: d.cents }));
    return { rows, summary: { day: "Total", sales: rows.reduce((s, r) => s + r.sales, 0), invoices: rows.reduce((s, r) => s + r.invoices, 0) } };
  },
};

const labSales = {
  key: "sales.lab", group: GROUP, roles: ADMIN, title: "Lab Sales",
  description: "Sales by channel: lab orders, the shop, and invoices imported from Seazona.",
  params: [RANGE],
  columns: [
    { id: "channel", label: "Channel", type: "text" }, { id: "invoices", label: "Invoices", type: "int" }, money("sales", "Sales"),
    { id: "share", label: "Share", type: "pct" },
  ],
  chart: { type: "bar", x: "channel", series: [{ field: "sales", label: "Sales" }] },
  async run(tx, { range }) {
    const raw = await rowsOf(tx, sql`
      select ${invoices.kind} as "kind", count(*) as "invoices", sum(${invoices.subtotalCents}) as "cents"
      from ${invoices} where ${salesWhere(range)} group by 1`);
    const byKind = new Map(raw.map((r) => [r.kind, r]));
    const total = raw.reduce((s, r) => s + num(r.cents), 0);
    const rows = INVOICE_KINDS.map((k) => {
      const cents = num(byKind.get(k)?.cents);
      return { channel: INVOICE_KIND_LABELS[k] ?? k, invoices: num(byKind.get(k)?.invoices), sales: cents, share: share(cents, total) };
    });
    return { rows, summary: { channel: "Total", invoices: rows.reduce((s, r) => s + r.invoices, 0), sales: total, share: total ? 1 : 0 } };
  },
};

const netChart = {
  key: "sales.net-chart", group: GROUP, roles: ADMIN, title: "Net Sales Chart",
  description: "Net sales per month.",
  params: [{ ...RANGE, default: "last12m" }],
  columns: [{ id: "month", label: "Month", type: "text" }, money("net", "Net sales")],
  chart: { type: "line", x: "month", series: [{ field: "net", label: "Net sales" }] },
  async run(tx, { range }) {
    const rows = (await salesByMonth(tx, range)).map((m) => ({ month: m.month, net: m.cents }));
    return { rows, summary: { month: "Total", net: rows.reduce((s, r) => s + r.net, 0) } };
  },
};

const category = {
  key: "sales.category", group: GROUP, roles: ADMIN, title: "Product Category Sales",
  description: "Sales by product category (each line's product family). Lines with no product are grouped as adjustments, fees or \"No product\".",
  params: [RANGE],
  columns: [{ id: "category", label: "Category", type: "text" }, { id: "units", label: "Units", type: "int" }, money("amount", "Sales")],
  chart: { type: "bar", x: "category", series: [{ field: "amount", label: "Sales" }] },
  async run(tx, { range }) {
    // A line names its variant; an imported line only its code, so it is matched to the catalog by code.
    const raw = await rowsOf(tx, sql`
      select coalesce(${productFamilies.category}, case
          when ${productFamilies.id} is not null then 'Uncategorized'
          when ${invoiceLines.kind} = 'adjustment' then 'Adjustments'
          when ${invoiceLines.kind} = 'fee' then 'Fees'
          else 'No product' end) as "category",
        sum(case when ${invoiceLines.kind} = 'item' then ${invoiceLines.qty} else 0 end) as "units",
        sum(${invoiceLines.lineCents}) as "amount"
      from ${invoiceLines}
      join ${invoices} on ${invoices.id} = ${invoiceLines.invoiceId}
      ${catalogJoins(invoiceLines)}
      where ${invoiceLines.kind} <> 'shipping' and ${salesWhere(range)}
      group by 1 order by 3 desc, 1`);
    const rows = raw.map((r) => ({ category: r.category, units: num(r.units), amount: num(r.amount) }));
    const notice = coverageNotice(range) ?? undefined;
    return {
      rows, notice,
      summary: { category: "Total", units: rows.reduce((s, r) => s + r.units, 0), amount: rows.reduce((s, r) => s + r.amount, 0) },
    };
  },
};

const byClient = {
  key: "sales.by-client", group: GROUP, roles: ADMIN, title: "Sales By Doctor", paging: "server",
  description: "Sales per client (doctor), with each client's share of the range's sales. Guest shop orders have no client and are left out.",
  params: [RANGE],
  columns: [
    { id: "client", label: "Client", type: "text", link: CLIENT_LINK }, { id: "accountNumber", label: "Account", type: "text" },
    { id: "invoices", label: "Invoices", type: "int" }, money("sales", "Sales"), { id: "share", label: "Share", type: "pct" },
    { id: "lastInvoice", label: "Last invoice", type: "date" },
  ],
  async run(tx, { range }, _actor, ctx) {
    const where = sql`${salesWhere(range)} and ${invoices.clientUserId} is not null`;
    const cents = sql`sum(${invoices.subtotalCents})`;
    const sorts = {
      client: clientName, accountNumber: users.seazonaAccountNumber, invoices: sql`count(*)`, sales: cents, share: cents,
      lastInvoice: sql`max(${invoices.issuedAt})`,
    };
    const [totals] = await rowsOf(tx, sql`
      select count(distinct ${invoices.clientUserId}) as "total", coalesce(sum(${invoices.subtotalCents}), 0) as "cents", count(*) as "invoices"
      from ${invoices} where ${where}`);
    const raw = await rowsOf(tx, sql`
      select ${users.id} as "clientUserId", ${clientName} as "client", ${users.seazonaAccountNumber} as "accountNumber",
        count(*) as "invoices", ${cents} as "cents", max(${labDayText(invoices.issuedAt)}) as "lastDay"
      from ${invoices} join ${users} on ${users.id} = ${invoices.clientUserId} left join ${doctorProfiles} on ${doctorProfiles.userId} = ${users.id}
      where ${where}
      group by ${users.id}, ${doctorProfiles.companyName}, ${users.name}, ${users.seazonaAccountNumber}
      ${orderAndPage(ctx?.page, sorts, { id: "sales", desc: true }, users.id)}`);
    const totalCents = num(totals?.cents);
    const rows = raw.map((r) => ({
      clientUserId: r.clientUserId, client: r.client, accountNumber: r.accountNumber ?? null, invoices: num(r.invoices),
      sales: num(r.cents), share: share(num(r.cents), totalCents), lastInvoice: r.lastDay ?? null,
    }));
    return { rows, total: num(totals?.total), summary: { client: "Total", invoices: num(totals?.invoices), sales: totalCents, share: totalCents ? 1 : 0 } };
  },
};

export const SALES_REPORTS = [comparison, summary, daily, labSales, netChart, category, byClient];

export function registerSalesReports(registry) {
  for (const def of SALES_REPORTS) registry.defineReport(def);
}
