/**
 * Clients (9). Same Pricing waits for piece 10's price lists (registered with
 * `requires`, dependent.js). Clients are doctor users; orders are non-cancelled lab orders by lab-local received day;
 * sales are the one sales rule in lab-metrics.js. Every report is admin only
 * except the two lists, which carry no money and are staff.
 */
import { sql } from "drizzle-orm";
import { addDays, daysBetween } from "@my-app/shared";
import { invoices, labOrders, users, doctorProfiles, memberships, accounts } from "../../../db/schema/index.js";
import {
  CLIENT_LINK, ORDER_LINK, afterLabDay, clientName, isClient, isLiveOrder, isSale, labDayBetween, labDayText, labToday, num, rowsOf, salesWhere,
} from "./lab-metrics.js";
import { HEALTH_BANDS, clientHealthRows, healthCounts } from "./client-health.js";
import { dependentReport } from "./dependent.js";

const ADMIN = ["admin"];
const GROUP = "clients";
const RANGE = { name: "range", label: "Dates", type: "dateRange", default: "last12m", maxDays: 1100 };
const COUNT = { name: "count", label: "How many clients", type: "number", default: 25, min: 1, max: 500 };
const DAYS = { name: "days", label: "Days", type: "number", default: 90, min: 1, max: 3650 };
const CLIENT_COL = { id: "client", label: "Client", type: "text", link: CLIENT_LINK };
const ACCOUNT_COL = { id: "accountNumber", label: "Account", type: "text" };
const money = (id, label) => ({ id, label, type: "money" });
const share = (part, whole) => (whole ? part / whole : 0);
const sumOf = (rows, k) => rows.reduce((s, r) => s + (r[k] ?? 0), 0);
const whole = (v, fallback) => (Number.isFinite(v) ? Math.trunc(v) : fallback);
const capital = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** asOf for the health rule: the pinned instant, else now. */
const asOfOf = (ctx) => ctx?.now ?? new Date();

/** Join a lab_orders/invoices client column to the client and their profile. */
const clientJoin = (col) => sql`join ${users} on ${users.id} = ${col} and ${isClient} left join ${doctorProfiles} on ${doctorProfiles.userId} = ${users.id}`;
const clientGroup = sql`${users.id}, ${doctorProfiles.companyName}, ${users.name}, ${users.seazonaAccountNumber}`;

// ── Client Health ────────────────────────────────────────────────────────

const BAND_LABEL = Object.fromEntries(HEALTH_BANDS.map((b) => [b.value, b.label]));
const BAND_ORDER = Object.fromEntries(HEALTH_BANDS.map((b, i) => [b.value, i]));

const health = {
  key: "clients.health", group: GROUP, roles: ADMIN, featured: true, title: "Client Health",
  description:
    "Each client's orders in the last 30 days against their monthly average over the 6 months before (days 31–210). " +
    "Inactive: no order in 90 days. Declining: under 50% of their average. Stable: 50–85%. Healthy: 85% or more, or a new client. " +
    "Clients who have never ordered are not listed; cancelled orders do not count.",
  params: [{ name: "band", label: "Band", type: "select", options: HEALTH_BANDS }],
  columns: [
    CLIENT_COL, { id: "band", label: "Health", type: "badge" }, { id: "trend", label: "Trend", type: "pct" },
    { id: "recent", label: "Orders (30 days)", type: "int" }, { id: "baseline", label: "Monthly average", type: "int" },
    money("sales30", "Sales (30 days)"), { id: "turnaround", label: "Avg turnaround (30 days)", type: "duration_days" },
    { id: "last6", label: "Orders per 30 days (oldest first)", type: "text", sortable: false },
    { id: "lastOrder", label: "Last order", type: "date" },
  ],
  async run(tx, params, _actor, ctx) {
    const all = await clientHealthRows(tx, { asOf: asOfOf(ctx) });
    const picked = params?.band ? all.filter((r) => r.band === params.band) : all;
    const rows = picked
      .sort((a, b) => BAND_ORDER[a.band] - BAND_ORDER[b.band] || b.sales30Cents - a.sales30Cents || String(a.client).localeCompare(String(b.client)))
      .map((r) => ({
        clientUserId: r.clientUserId, client: r.client,
        band: { value: r.band, label: r.isNew ? `${BAND_LABEL[r.band]} (new)` : BAND_LABEL[r.band] },
        trend: r.trend, recent: r.recent, baseline: Math.round(r.baseline * 10) / 10, sales30: r.sales30Cents,
        turnaround: r.avgTurnaroundDays == null ? null : Math.round(r.avgTurnaroundDays * 10) / 10,
        last6: r.monthly.join(" · "), monthly: r.monthly, lastOrder: r.lastOrderDay,
      }));
    const c = healthCounts(all);
    return {
      rows,
      summary: { client: "Total", recent: sumOf(rows, "recent"), sales30: sumOf(rows, "sales30") },
      notice: `${c.active} active (${c.declining} declining, ${c.inactive} inactive) of ${all.length} clients who have ordered.`,
    };
  },
};

// ── Lists (staff, no money) ──────────────────────────────────────────────

const statusBadge = (s) => (s ? { value: s, label: capital(s) } : null);

const list = {
  key: "clients.list", group: GROUP, title: "Client List",
  description: "Every client (doctor) with their practice, account number, status and last order. Cancelled orders do not count.",
  params: [{ name: "includeInactive", label: "Include suspended and deleted", type: "toggle", default: false }],
  columns: [
    { id: "client", label: "Client", type: "text" }, { id: "doctor", label: "Doctor", type: "text" }, ACCOUNT_COL,
    { id: "city", label: "City", type: "text" }, { id: "state", label: "State", type: "text" }, { id: "phone", label: "Phone", type: "text" },
    { id: "status", label: "Status", type: "badge" }, { id: "orders", label: "Orders", type: "int" }, { id: "lastOrder", label: "Last order", type: "date" },
  ],
  async run(tx, params) {
    const active = params?.includeInactive ? sql`` : sql` and ${users.status} = 'active'`;
    const raw = await rowsOf(tx, sql`
      select ${users.id} as "userId", ${clientName} as "client", ${users.name} as "doctor", ${users.seazonaAccountNumber} as "accountNumber",
        ${doctorProfiles.city} as "city", ${doctorProfiles.state} as "state", ${doctorProfiles.phone} as "phone", ${users.status} as "status",
        lo.orders as "orders", lo.last_day as "lastDay"
      from ${users}
      left join ${doctorProfiles} on ${doctorProfiles.userId} = ${users.id}
      left join (
        select ${labOrders.clientUserId} as client_user_id, count(*) as orders, ${labDayText(sql`max(${labOrders.receivedAt})`)} as last_day
        from ${labOrders} where ${isLiveOrder} group by 1
      ) lo on lo.client_user_id = ${users.id}
      where ${isClient}${active}
      order by 2, 1`);
    const rows = raw.map((r) => ({
      userId: r.userId, client: r.client, doctor: r.doctor, accountNumber: r.accountNumber ?? null, city: r.city ?? null, state: r.state ?? null,
      phone: r.phone ?? null, status: statusBadge(r.status), orders: num(r.orders), lastOrder: r.lastDay ?? null,
    }));
    return { rows };
  },
};

const doctors = {
  key: "clients.doctors", group: GROUP, title: "Doctors List",
  description: "Every doctor with their practice and the practice accounts they are an active member of.",
  params: [{ name: "includeInactive", label: "Include suspended and deleted", type: "toggle", default: false }],
  columns: [
    { id: "doctor", label: "Doctor", type: "text" }, { id: "practice", label: "Practice", type: "text" }, ACCOUNT_COL,
    { id: "accounts", label: "Member of", type: "text" }, { id: "accountCount", label: "Accounts", type: "int" },
    { id: "status", label: "Status", type: "badge" },
  ],
  async run(tx, params) {
    const active = params?.includeInactive ? sql`` : sql` and ${users.status} = 'active'`;
    const raw = await rowsOf(tx, sql`
      select ${users.id} as "userId", ${users.name} as "doctor", ${doctorProfiles.companyName} as "practice",
        ${users.seazonaAccountNumber} as "accountNumber", ${users.status} as "status",
        string_agg(${accounts.name}, ', ' order by ${accounts.name}) as "accounts", count(${accounts.id}) as "accountCount"
      from ${users}
      left join ${doctorProfiles} on ${doctorProfiles.userId} = ${users.id}
      left join ${memberships} on ${memberships.userId} = ${users.id} and ${memberships.status} = 'active'
      left join ${accounts} on ${accounts.id} = ${memberships.accountId} and ${accounts.status} <> 'deleted'
      where ${isClient}${active}
      group by ${users.id}, ${doctorProfiles.companyName}
      order by 2, 1`);
    const rows = raw.map((r) => ({
      userId: r.userId, doctor: r.doctor, practice: r.practice ?? null, accountNumber: r.accountNumber ?? null,
      accounts: r.accounts ?? null, accountCount: num(r.accountCount), status: statusBadge(r.status),
    }));
    return { rows };
  },
};

// ── Top / Bottom ─────────────────────────────────────────────────────────

const RANKED_COLUMNS = [
  { id: "rank", label: "#", type: "int" }, CLIENT_COL, ACCOUNT_COL, { id: "invoices", label: "Invoices", type: "int" },
  money("sales", "Sales"), { id: "share", label: "Share of client sales", type: "pct" },
];

/**
 * Clients ranked by sales in the range. Top: clients with sales. Bottom: every
 * client with a non-cancelled order in the 12 months ending with the range,
 * $0 included. Share is of all client-attributed sales in the range.
 */
async function rankedClients(tx, { range, count, bottom }) {
  const eligible = bottom
    ? sql`exists (select 1 from ${labOrders} where ${labOrders.clientUserId} = ${users.id} and ${isLiveOrder}
        and ${labDayBetween(labOrders.receivedAt, { from: addDays(range.to, -364), to: range.to })})`
    : sql`s.cents is not null`;
  const raw = await rowsOf(tx, sql`
    select ${users.id} as "clientUserId", ${clientName} as "client", ${users.seazonaAccountNumber} as "accountNumber",
      coalesce(s.invoices, 0) as "invoices", coalesce(s.cents, 0) as "cents",
      (select coalesce(sum(${invoices.subtotalCents}), 0) from ${invoices} where ${salesWhere(range)} and ${invoices.clientUserId} is not null) as "total"
    from ${users}
    left join ${doctorProfiles} on ${doctorProfiles.userId} = ${users.id}
    left join (
      select ${invoices.clientUserId} as client_user_id, count(*) as invoices, sum(${invoices.subtotalCents}) as cents
      from ${invoices} where ${salesWhere(range)} group by 1
    ) s on s.client_user_id = ${users.id}
    where ${isClient} and ${eligible}
    order by coalesce(s.cents, 0) ${sql.raw(bottom ? "asc" : "desc")}, ${users.id} asc
    limit ${count}`);
  return raw.map((r, i) => ({
    rank: i + 1, clientUserId: r.clientUserId, client: r.client, accountNumber: r.accountNumber ?? null,
    invoices: num(r.invoices), sales: num(r.cents), share: share(num(r.cents), num(r.total)),
  }));
}

const top = {
  key: "clients.top", group: GROUP, roles: ADMIN, title: "Top Clients",
  description: "The clients with the most sales in the range.",
  params: [RANGE, COUNT], columns: RANKED_COLUMNS,
  async run(tx, params) {
    const rows = await rankedClients(tx, { range: params.range, count: whole(params.count, 25), bottom: false });
    return { rows, summary: { client: "Total", invoices: sumOf(rows, "invoices"), sales: sumOf(rows, "sales") } };
  },
};

const bottomClients = {
  key: "clients.bottom", group: GROUP, roles: ADMIN, title: "Bottom Clients",
  description: "The clients with the least sales in the range, among clients with an order in the 12 months ending with the range (including $0).",
  params: [RANGE, COUNT], columns: RANKED_COLUMNS,
  async run(tx, params) {
    const rows = await rankedClients(tx, { range: params.range, count: whole(params.count, 25), bottom: true });
    return { rows, summary: { client: "Total", invoices: sumOf(rows, "invoices"), sales: sumOf(rows, "sales") } };
  },
};

// ── Inactive / New / No recent sales ─────────────────────────────────────

const inactive = {
  key: "clients.inactive", group: GROUP, roles: ADMIN, title: "Inactive Clients",
  description: "Clients whose last order was more than the chosen number of lab days ago (default 90, the Client Health \"Inactive\" rule), with their lifetime sales. Clients who have never ordered are not listed.",
  params: [DAYS],
  columns: [
    CLIENT_COL, ACCOUNT_COL, { id: "lastOrder", label: "Last order", type: "date" },
    { id: "daysSince", label: "Days since", type: "int" }, money("lifetimeSales", "Lifetime sales"),
  ],
  async run(tx, params, _actor, ctx) {
    const today = labToday(ctx);
    // Inactive = MORE than N lab days since the last order (activityHealth's rule), so the last
    // order is on or before today - (N + 1); an order exactly N days ago is not inactive yet.
    const cut = addDays(today, -(whole(params?.days, 90) + 1));
    const raw = await rowsOf(tx, sql`
      select ${users.id} as "clientUserId", ${clientName} as "client", ${users.seazonaAccountNumber} as "accountNumber",
        ${labDayText(sql`max(${labOrders.receivedAt})`)} as "lastDay", ls.cents as "lifetime"
      from ${labOrders}
      ${clientJoin(labOrders.clientUserId)}
      left join (
        select ${invoices.clientUserId} as client_user_id, sum(${invoices.subtotalCents}) as cents from ${invoices} where ${isSale} group by 1
      ) ls on ls.client_user_id = ${users.id}
      where ${isLiveOrder}
      group by ${clientGroup}, ls.cents
      having max(${labOrders.receivedAt}) < ${afterLabDay(cut)}
      order by max(${labOrders.receivedAt}) desc, ${users.id}`);
    const rows = raw.map((r) => ({
      clientUserId: r.clientUserId, client: r.client, accountNumber: r.accountNumber ?? null, lastOrder: r.lastDay,
      daysSince: daysBetween(r.lastDay, today).length - 1, lifetimeSales: num(r.lifetime),
    }));
    return { rows, summary: { client: "Total", lifetimeSales: sumOf(rows, "lifetimeSales") } };
  },
};

const newOrders = {
  key: "clients.new-orders", group: GROUP, roles: ADMIN, title: "New Client Orders",
  description: "Clients whose first-ever order (cancelled orders aside) was received in the range.",
  params: [{ ...RANGE, default: "last30" }],
  columns: [
    CLIENT_COL, ACCOUNT_COL, { id: "firstOrder", label: "First order", type: "date" },
    { id: "firstOrderNumber", label: "First order #", type: "text", link: ORDER_LINK.replace("{labOrderId}", "{firstOrderId}") },
    { id: "orders", label: "Orders in range", type: "int" },
  ],
  async run(tx, { range }) {
    const first = sql`min(${labOrders.receivedAt})`;
    const raw = await rowsOf(tx, sql`
      select ${users.id} as "clientUserId", ${clientName} as "client", ${users.seazonaAccountNumber} as "accountNumber",
        ${labDayText(first)} as "firstDay",
        (array_agg(${labOrders.id} order by ${labOrders.receivedAt}, ${labOrders.id}))[1] as "firstOrderId",
        (array_agg(${labOrders.orderNumber} order by ${labOrders.receivedAt}, ${labOrders.id}))[1] as "firstOrderNumber",
        count(*) filter (where ${labDayBetween(labOrders.receivedAt, range)}) as "orders"
      from ${labOrders}
      ${clientJoin(labOrders.clientUserId)}
      where ${isLiveOrder}
      group by ${clientGroup}
      having ${labDayBetween(first, range)}
      order by ${first}, ${users.id}`);
    const rows = raw.map((r) => ({
      clientUserId: r.clientUserId, client: r.client, accountNumber: r.accountNumber ?? null, firstOrder: r.firstDay,
      firstOrderId: r.firstOrderId, firstOrderNumber: r.firstOrderNumber, orders: num(r.orders),
    }));
    return { rows, summary: { client: "Total", orders: sumOf(rows, "orders") } };
  },
};

const noRecentSales = {
  key: "clients.no-recent-sales", group: GROUP, roles: ADMIN, title: "No Recent Sales",
  description: "Clients with sales in the 12 months before the last N days (default 90) but none in the last N days.",
  params: [DAYS],
  columns: [CLIENT_COL, ACCOUNT_COL, money("priorSales", "Sales in the prior 12 months"), { id: "lastSale", label: "Last sale", type: "date" }],
  async run(tx, params, _actor, ctx) {
    const today = labToday(ctx);
    const recent = { from: addDays(today, -(whole(params?.days, 90) - 1)), to: today };
    const prior = { from: addDays(recent.from, -365), to: addDays(recent.from, -1) };
    const raw = await rowsOf(tx, sql`
      select ${users.id} as "clientUserId", ${clientName} as "client", ${users.seazonaAccountNumber} as "accountNumber",
        sum(${invoices.subtotalCents}) filter (where ${labDayBetween(invoices.issuedAt, prior)}) as "prior",
        ${labDayText(sql`max(${invoices.issuedAt})`)} as "lastDay"
      from ${invoices}
      ${clientJoin(invoices.clientUserId)}
      where ${salesWhere({ from: prior.from, to: recent.to })}
      group by ${clientGroup}
      having count(*) filter (where ${labDayBetween(invoices.issuedAt, recent)}) = 0
      order by 4 desc nulls last, ${users.id}`);
    const rows = raw.map((r) => ({
      clientUserId: r.clientUserId, client: r.client, accountNumber: r.accountNumber ?? null, priorSales: num(r.prior), lastSale: r.lastDay,
    }));
    return {
      rows, summary: { client: "Total", priorSales: sumOf(rows, "priorSales") },
      notice: `No sales ${recent.from} to ${recent.to}; sales ${prior.from} to ${prior.to}.`,
    };
  },
};

const samePricing = dependentReport({
  key: "clients.same-pricing", group: GROUP, roles: ADMIN, title: "Same Pricing", requires: ["price-lists"],
  description: "Clients grouped by an identical set of prices (the same price list or the same client prices).",
  params: [],
  columns: [
    { id: "priceSet", label: "Price set", type: "text" }, { id: "clients", label: "Clients", type: "int" },
    { id: "clientNames", label: "Client names", type: "text", sortable: false }, { id: "items", label: "Priced items", type: "int" },
  ],
});

export const CLIENT_REPORTS = [health, list, doctors, top, bottomClients, inactive, newOrders, noRecentSales, samePricing];

export function registerClientReports(registry) {
  for (const def of CLIENT_REPORTS) registry.defineReport(def);
}
