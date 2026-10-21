import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { isOpeningBalanceInvoice, isoDateIn, LAB_TIMEZONE, LEGACY_SETTLEMENT_SOURCE, OPENING_BALANCE_PREFIX, TERMINAL_LAB_STATUSES } from "@my-app/shared";
import { users, invoices, invoicePayments, labOrders } from "../db/schema/index.js";
import { paidCentsFor } from "../services/billing/paid-cents.js";
import { deriveBalance } from "../services/billing/invoice-rules.js";
import { orderStatusFor } from "./seazona-records.js";
import { isPlaceholderEmail } from "./map-clients.js";
import { normAccount } from "./owners.js";
import { accountsByInvoice } from "./load-balances.js";
import { seazonaInvoiceFacts } from "./parity.js";

const CHUNK = 1000;
const LIST_CAP = 50;
const isOpenStatus = (status) => !TERMINAL_LAB_STATUSES.includes(status);

/** The raw store's side of parity. Opens records in memory; returns ids, numbers, statuses and cents only. */
export async function readSeazonaSide(raw) {
  const clients = await raw.records("client");
  const summaries = await raw.records("invoice");
  const details = new Map((await raw.records("invoice_detail")).map((r) => [r.seazonaId, r.payload]));
  const orders = await raw.records("order");
  return {
    clientIds: clients.map((c) => c.seazonaId),
    invoices: seazonaInvoiceFacts(summaries, details),
    orders: orders.map(({ seazonaId, payload }) => {
      const m = orderStatusFor(payload.status);
      return {
        id: seazonaId, clientId: payload.clientId == null || payload.clientId === "" ? null : String(payload.clientId),
        status: m?.status ?? "unknown", open: Boolean(m) && isOpenStatus(m.status),
      };
    }),
  };
}

/** Runs `read(chunk)` over `ids` 1000 at a time (an `in (...)` list stays small at 16k invoices). */
async function inChunks(ids, read) {
  const out = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await read(ids.slice(i, i + CHUNK))));
  return out;
}

async function paidByInvoice(db, ids) {
  const paid = new Map();
  for (let i = 0; i < ids.length; i += CHUNK) for (const [id, cents] of await paidCentsFor(ids.slice(i, i + CHUNK), db)) paid.set(id, cents);
  return paid;
}

const legacyColumns = {
  id: invoices.id, invoiceNumber: invoices.invoiceNumber, kind: invoices.kind, legacySeazonaInvoiceId: invoices.legacySeazonaInvoiceId,
  clientUserId: invoices.clientUserId, status: invoices.status, totalCents: invoices.totalCents, issuedAt: invoices.issuedAt,
};

/** Money on the target's legacy invoices: open balance per account, what AR cannot see, and history left without a settlement. */
async function legacyMoney({ db, raw, legacy, accountOfUser }) {
  const ids = legacy.map((i) => i.id);
  const paid = await paidByInvoice(db, ids);
  const history = legacy.filter((i) => !isOpeningBalanceInvoice(i));
  const accountOfHistory = await accountsByInvoice(raw, history);
  // THE account key of an invoice, shared by the balance map and the per-invoice export roll-up.
  const accountKey = (inv) => {
    if (isOpeningBalanceInvoice(inv)) return normAccount(inv.legacySeazonaInvoiceId.slice(OPENING_BALANCE_PREFIX.length)) ?? `invoice ${inv.invoiceNumber}`;
    return accountOfHistory.get(inv.legacySeazonaInvoiceId) ?? normAccount(accountOfUser.get(inv.clientUserId)) ?? `invoice ${inv.invoiceNumber}`;
  };
  const balanceByAccount = new Map();
  const unowned = { count: 0, openCents: 0, invoiceNumbers: [] };
  for (const inv of legacy) {
    const owed = inv.status === "issued" ? Math.max(deriveBalance(inv, paid.get(inv.id) ?? 0).balanceCents, 0) : 0;
    if (inv.status === "issued") {
      const key = accountKey(inv);
      balanceByAccount.set(key, (balanceByAccount.get(key) ?? 0) + owed);
    }
    if (!inv.clientUserId) {
      unowned.count += 1;
      unowned.openCents += owed;
      if (unowned.invoiceNumbers.length < LIST_CAP) unowned.invoiceNumbers.push(inv.invoiceNumber);
    }
  }
  // History invoices with no settlement row: their gross total, the REAL payments already on them (no settlement is
  // ever counted here) and what is still open. Gross alone overstates what staff must chase.
  const issuedHistory = history.filter((i) => i.status === "issued");
  const settled = new Set((await inChunks(issuedHistory.map((i) => i.id), (chunk) =>
    db.selectDistinct({ invoiceId: invoicePayments.invoiceId }).from(invoicePayments)
      .where(and(eq(invoicePayments.source, LEGACY_SETTLEMENT_SOURCE), inArray(invoicePayments.invoiceId, chunk))))).map((r) => r.invoiceId));
  const open = issuedHistory.filter((i) => !settled.has(i.id));
  const historyWithoutSettlement = {
    count: open.length,
    grossCents: open.reduce((n, i) => n + i.totalCents, 0),
    realPaidCents: open.reduce((n, i) => n + (paid.get(i.id) ?? 0), 0),
    openCents: open.reduce((n, i) => n + Math.max(deriveBalance(i, paid.get(i.id) ?? 0).balanceCents, 0), 0),
  };
  return { history, accountKey, balanceByAccount, unowned, historyWithoutSettlement };
}

/** The target's side of parity, strictly reads. Balances use the app's own ledger rule (deriveBalance over paidCentsFor). */
export async function readAppSide(db, raw) {
  const userRows = await db
    .select({ id: users.id, email: users.email, seazonaClientId: users.seazonaClientId, seazonaAccountNumber: users.seazonaAccountNumber })
    .from(users)
    .where(isNotNull(users.seazonaClientId));
  const legacy = await db.select(legacyColumns).from(invoices).where(eq(invoices.kind, "legacy"));
  const orders = await db.select({ sourceId: labOrders.sourceId, status: labOrders.status, clientUserId: labOrders.clientUserId }).from(labOrders).where(eq(labOrders.source, "legacy"));
  const m = await legacyMoney({ db, raw, legacy, accountOfUser: new Map(userRows.map((u) => [u.id, u.seazonaAccountNumber])) });
  return {
    linkedClientIds: userRows.map((u) => String(u.seazonaClientId)),
    linkedCount: userRows.length,
    placeholders: userRows.filter((u) => isPlaceholderEmail(u.email)).length,
    invoices: m.history.map((i) => ({
      seazonaId: i.legacySeazonaInvoiceId, number: i.invoiceNumber, status: i.status, totalCents: i.totalCents,
      year: isoDateIn(LAB_TIMEZONE, new Date(i.issuedAt)).slice(0, 4),
    })),
    accountByInvoiceNumber: new Map(m.history.map((i) => [i.invoiceNumber, m.accountKey(i)])),
    balanceByAccount: m.balanceByAccount,
    unowned: m.unowned,
    historyWithoutSettlement: m.historyWithoutSettlement,
    orderCount: orders.length,
    openOrders: orders.filter((o) => isOpenStatus(o.status)),
    unownedOrders: orders.filter((o) => !o.clientUserId).map((o) => ({ sourceId: o.sourceId, open: isOpenStatus(o.status) })),
    openingInvoices: legacy.length - m.history.length,
  };
}

/**
 * The target handed to parity: selects only. Parity must never change
 * the target, so a write method throws instead of reaching the database.
 */
export function readOnly(db) {
  const refuse = (name) => () => { throw new Error(`Parity is read-only: db.${name}() is not allowed.`); };
  return new Proxy(db, {
    get(target, prop) {
      if (["insert", "update", "delete", "transaction", "execute"].includes(prop)) return refuse(prop);
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
