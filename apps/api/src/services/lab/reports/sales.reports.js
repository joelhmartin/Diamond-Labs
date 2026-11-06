/**
 * Sales (8). Admin only. Sales By Rep groups by each client's rep: piece 6
 * record-tags on the client (record type "client_rep", lab-tags.js). Every figure is the one sales rule in lab-metrics.js: issued
 * invoices' subtotal by lab-local issue day.
 */
import { sql } from "drizzle-orm";
import { INVOICE_KINDS, INVOICE_KIND_LABELS } from "@my-app/shared";
import { invoices, invoiceLines, productFamilies, users, doctorProfiles } from "../../../db/schema/index.js";
import {
  CLIENT_LINK, catalogJoins, clientName, coverageNotice, discountNotices, labDayText, labToday, num, orderAndPage, rowsOf, salesBreakdown, salesByDay, salesByMonth, salesWhere,
} from "./lab-metrics.js";
import { listDefinitions, tagsFor } from "../../../modules/record-tags/index.js";
import { CLIENT_REP_RECORD_TYPE } from "../lab-tags.js";
import { ADMIN, PRACTICE_PARAMS, money, practiceScope, share, sumOf, sums, uncategorizedSql } from "./report-helpers.js";

const GROUP = "sales";
const RANGE = { name: "range", label: "Dates", type: "dateRange", default: "last30", maxDays: 1100 };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const comparison = {
  key: "sales.comparison", group: GROUP, roles: ADMIN, featured: true, title: "Sales Comparison",
  description: "Monthly sales for a year and the two before it.",
  params: [{ name: "year", label: "Year (default this year)", type: "number", min: 2000, max: 2100 }, ...PRACTICE_PARAMS],
  columns: [
    { id: "month", label: "Month", type: "text", sortable: false },
    money("y2", "Two years before"), money("y1", "Year before"), money("y0", "Selected year"),
  ],
  chart: {
    type: "groupedBar", x: "month",
    series: [{ field: "y2", label: "Two years before" }, { field: "y1", label: "Year before" }, { field: "y0", label: "Selected year" }],
  },
  async run(tx, params, _actor, ctx) {
    const year = Number.isInteger(params?.year) ? params.year : Number(labToday(ctx).slice(0, 4));
    const byMonth = new Map((await salesByMonth(tx, { from: `${year - 2}-01-01`, to: `${year}-12-31` }, practiceScope(params))).map((m) => [m.month, m.cents]));
    const cents = (y, i) => byMonth.get(`${y}-${String(i + 1).padStart(2, "0")}`) ?? 0;
    const rows = MONTHS.map((month, i) => ({ month, y2: cents(year - 2, i), y1: cents(year - 1, i), y0: cents(year, i) }));
    return { rows, summary: { month: "Total", ...sums(rows, ["y2", "y1", "y0"]) }, notice: `Comparing ${year - 2}, ${year - 1} and ${year}.` };
  },
};

const summary = {
  key: "sales.summary", group: GROUP, roles: ADMIN, featured: true, title: "Sales Summary",
  description: "Gross, discounts, net sales, tax, shipping and total for the range and the period it compares with: the same period one back for month, quarter or year to date, last month, last year and last 12 months; the equal-length period just before for other ranges. Net is the sales figure.",
  params: [RANGE, ...PRACTICE_PARAMS],
  columns: [
    { id: "period", label: "Period", type: "text" }, { id: "from", label: "From", type: "date" }, { id: "to", label: "To", type: "date" },
    { id: "invoices", label: "Invoices", type: "int" }, money("gross", "Gross"), money("discount", "Discounts"), money("net", "Net sales"),
    money("tax", "Tax"), money("shipping", "Shipping"), money("total", "Total billed"),
  ],
  async run(tx, params) {
    const { range } = params;
    const scope = practiceScope(params);
    const row = async (period, r) => {
      const b = await salesBreakdown(tx, r, scope);
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
  params: [{ ...RANGE, maxDays: 366 }, ...PRACTICE_PARAMS],
  columns: [{ id: "day", label: "Day", type: "date" }, { id: "invoices", label: "Invoices", type: "int" }, money("sales", "Sales")],
  chart: { type: "bar", x: "day", series: [{ field: "sales", label: "Sales" }] },
  async run(tx, params) {
    const rows = (await salesByDay(tx, params.range, practiceScope(params))).map((d) => ({ day: d.day, invoices: d.invoices, sales: d.cents }));
    return { rows, summary: { day: "Total", sales: sumOf(rows, "sales"), invoices: sumOf(rows, "invoices") } };
  },
};

const labSales = {
  key: "sales.lab", group: GROUP, roles: ADMIN, title: "Lab Sales",
  description: "Sales by channel: lab orders, the shop, and invoices imported from Seazona.",
  params: [RANGE, ...PRACTICE_PARAMS],
  columns: [
    { id: "channel", label: "Channel", type: "text" }, { id: "invoices", label: "Invoices", type: "int" }, money("sales", "Sales"),
    { id: "share", label: "Share", type: "pct" },
  ],
  chart: { type: "bar", x: "channel", series: [{ field: "sales", label: "Sales" }] },
  async run(tx, params) {
    const raw = await rowsOf(tx, sql`
      select ${invoices.kind} as "kind", count(*) as "invoices", sum(${invoices.subtotalCents}) as "cents"
      from ${invoices} where ${salesWhere(params.range, practiceScope(params))} group by 1`);
    const byKind = new Map(raw.map((r) => [r.kind, r]));
    const total = raw.reduce((s, r) => s + num(r.cents), 0);
    const rows = INVOICE_KINDS.map((k) => {
      const cents = num(byKind.get(k)?.cents);
      return { channel: INVOICE_KIND_LABELS[k] ?? k, invoices: num(byKind.get(k)?.invoices), sales: cents, share: share(cents, total) };
    });
    return { rows, summary: { channel: "Total", invoices: sumOf(rows, "invoices"), sales: total, share: total ? 1 : 0 } };
  },
};

const netChart = {
  key: "sales.net-chart", group: GROUP, roles: ADMIN, title: "Net Sales Chart",
  description: "Net sales per month.",
  params: [{ ...RANGE, default: "last12m" }, ...PRACTICE_PARAMS],
  columns: [{ id: "month", label: "Month", type: "text" }, money("net", "Net sales")],
  chart: { type: "line", x: "month", series: [{ field: "net", label: "Net sales" }] },
  async run(tx, params) {
    const rows = (await salesByMonth(tx, params.range, practiceScope(params))).map((m) => ({ month: m.month, net: m.cents }));
    return { rows, summary: { month: "Total", net: sumOf(rows, "net") } };
  },
};

const category = {
  key: "sales.category", group: GROUP, roles: ADMIN, title: "Product Category Sales",
  description: "Sales by product category (each line's product family). Lines with no product are grouped as adjustments, fees or \"No product\".",
  params: [RANGE, ...PRACTICE_PARAMS],
  columns: [{ id: "category", label: "Category", type: "text" }, { id: "units", label: "Units", type: "int" }, money("amount", "Sales")],
  chart: { type: "bar", x: "category", series: [{ field: "amount", label: "Sales" }] },
  async run(tx, params) {
    const { range } = params;
    // A line names its variant; an imported line only its code, so it is matched to the catalog by code.
    const raw = await rowsOf(tx, sql`
      select coalesce(${productFamilies.category}, case
          when ${productFamilies.id} is not null then ${uncategorizedSql}
          when ${invoiceLines.kind} = 'adjustment' then 'Adjustments'
          when ${invoiceLines.kind} = 'fee' then 'Fees'
          else 'No product' end) as "category",
        sum(case when ${invoiceLines.kind} = 'item' then ${invoiceLines.qty} else 0 end) as "units",
        sum(${invoiceLines.lineCents}) as "amount"
      from ${invoiceLines}
      join ${invoices} on ${invoices.id} = ${invoiceLines.invoiceId}
      ${catalogJoins(invoiceLines)}
      where ${invoiceLines.kind} <> 'shipping' and ${salesWhere(range, practiceScope(params))}
      group by 1 order by 3 desc, 1`);
    const rows = raw.map((r) => ({ category: r.category, units: num(r.units), amount: num(r.amount) }));
    const notice = coverageNotice(range) ?? undefined;
    return {
      rows, notice,
      summary: { category: "Total", units: sumOf(rows, "units"), amount: sumOf(rows, "amount") },
    };
  },
};

const byClient = {
  key: "sales.by-client", group: GROUP, roles: ADMIN, title: "Sales By Doctor", paging: "server",
  description: "Sales per client (doctor), with each client's share of the range's sales. Guest shop orders have no client and are left out.",
  params: [RANGE, ...PRACTICE_PARAMS],
  columns: [
    { id: "client", label: "Client", type: "text", link: CLIENT_LINK }, { id: "accountNumber", label: "Account", type: "text" },
    { id: "invoices", label: "Invoices", type: "int" }, money("sales", "Sales"), { id: "share", label: "Share", type: "pct" },
    { id: "lastInvoice", label: "Last invoice", type: "date" },
  ],
  async run(tx, params, _actor, ctx) {
    const where = sql`${salesWhere(params.range, practiceScope(params))} and ${invoices.clientUserId} is not null`;
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

/** Sales with no client, or a client with no rep tag. */
export const NO_REP = "No rep";
export const NO_REPS_NOTICE = `No sales reps are set up yet, so every client shows as "${NO_REP}". An admin defines the reps and assigns them to clients.`;

/** The notice when nothing could be grouped by rep because no rep exists at all (only asked when no client had one). */
async function noRepsNotice(tx, groups) {
  if ([...groups.keys()].some((rep) => rep !== NO_REP)) return undefined;
  const defined = await listDefinitions(CLIENT_REP_RECORD_TYPE, {}, tx);
  return defined.length ? undefined : NO_REPS_NOTICE;
}

const byRep = {
  key: "sales.by-rep", group: GROUP, roles: ADMIN, title: "Sales By Rep", requires: ["record-tags"],
  description: `Sales in the range grouped by each client's rep (a rep tag on the client). A client with several reps counts under the first; untagged clients and sales with no client show as "${NO_REP}".`,
  params: [RANGE, ...PRACTICE_PARAMS],
  columns: [
    { id: "rep", label: "Rep", type: "text" }, { id: "clients", label: "Clients", type: "int" }, { id: "invoices", label: "Invoices", type: "int" },
    money("sales", "Sales"), { id: "share", label: "Share", type: "pct" },
  ],
  chart: { type: "bar", x: "rep", series: [{ field: "sales", label: "Sales" }] },
  async run(tx, params) {
    const perClient = await rowsOf(tx, sql`
      select ${invoices.clientUserId} as "clientUserId", count(*) as "invoices", sum(${invoices.subtotalCents}) as "cents"
      from ${invoices} where ${salesWhere(params.range, practiceScope(params))} group by 1`);
    const reps = await tagsFor(CLIENT_REP_RECORD_TYPE, perClient.map((r) => r.clientUserId).filter(Boolean), tx);
    const groups = new Map();
    for (const r of perClient) {
      const rep = (r.clientUserId && reps.get(r.clientUserId)?.[0]?.label) || NO_REP;
      let g = groups.get(rep);
      if (!g) groups.set(rep, (g = { rep, clients: 0, invoices: 0, sales: 0 }));
      if (r.clientUserId) g.clients += 1;
      g.invoices += num(r.invoices);
      g.sales += num(r.cents);
    }
    const total = sumOf([...groups.values()], "sales");
    const rows = [...groups.values()]
      .sort((a, b) => (a.rep === NO_REP) - (b.rep === NO_REP) || b.sales - a.sales || a.rep.localeCompare(b.rep))
      .map((g) => ({ ...g, share: share(g.sales, total) }));
    const notice = await noRepsNotice(tx, groups);
    return { rows, summary: { rep: "Total", ...sums(rows, ["clients", "invoices", "sales"]), share: total ? 1 : 0 }, ...(notice && { notice }) };
  },
};

export const SALES_REPORTS = [comparison, summary, daily, labSales, netChart, category, byClient, byRep];

export function registerSalesReports(registry) {
  for (const def of SALES_REPORTS) registry.defineReport(def);
}
