import { LAB_TIMEZONE, AGING_BUCKETS, MANUAL_PAYMENT_LABELS, formatUsDate, isoDateIn, isOpeningBalanceInvoice } from "@my-app/shared";
import { labIdentity } from "../../config/lab-identity.js";
import { formatCents } from "../../lib/money.js";
import { deepPrintable } from "../pdf/pdf-text.js";
import { ageBalances } from "./aging.js";
import { ledgerEntryKind } from "./invoice-views.js";
import { billToLines } from "./invoice-model.js";

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "YYYY-MM" → its first and last lab-local day and a label. */
export function monthBounds(month) {
  const m = MONTH.exec(month ?? "");
  if (!m) throw new RangeError(`Not a YYYY-MM month: ${month}`);
  const year = Number(m[1]);
  const mo = Number(m[2]);
  return {
    startIso: `${month}-01`,
    endIso: new Date(Date.UTC(year, mo, 0)).toISOString().slice(0, 10),
    label: `${MONTH_NAMES[mo - 1]} ${year}`,
  };
}

const labDay = (instant) => isoDateIn(LAB_TIMEZONE, new Date(instant));
const KIND_ORDER = { invoice: 0, payment: 1, settlement: 1, credit: 2, refund: 3, void: 4 };

function paymentLabel(source) {
  const manual = /^admin_(check|cash|ach|other)$/.exec(source ?? "");
  if (manual) return `Payment (${MANUAL_PAYMENT_LABELS[manual[1]]})`;
  if (source === "autopay") return "Payment (AutoPay)";
  return "Payment";
}

/**
 * Every dated money event on a client's account, signed as it moves the
 * balance: an invoice issued (+total), a payment or credit (−applied), a refund
 * (+), a void of an issued invoice (−total). Dates are lab-local days; a
 * manual payment is dated by when it was received. Drafts, voided drafts and
 * the refund write-ahead guard row carry no money.
 */
export function statementEvents({ invoices, payments }) {
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const events = [];
  for (const inv of invoices) {
    if (!inv.issuedAt) continue;
    const order = inv.labOrderNumber ? ` · Order #${inv.labOrderNumber}` : "";
    const description = isOpeningBalanceInvoice(inv) ? `Opening balance carried from Seazona — invoice #${inv.invoiceNumber}` : `Invoice #${inv.invoiceNumber}${order}`;
    events.push({ date: labDay(inv.issuedAt), kind: "invoice", invoiceId: inv.id, description, amountCents: inv.totalCents });
    if (inv.status === "void" && inv.voidedAt) {
      events.push({ date: labDay(inv.voidedAt), kind: "void", invoiceId: inv.id, description: `Void — invoice #${inv.invoiceNumber}`, amountCents: -inv.totalCents });
    }
  }
  for (const p of payments) {
    if (!p.appliedCents) continue;
    const kind = ledgerEntryKind(p);
    const number = byId.get(p.invoiceId)?.invoiceNumber ?? p.invoiceNumber;
    const label = kind === "credit" ? "Credit" : kind === "refund" ? "Refund" : kind === "settlement" ? "Settled in Seazona" : paymentLabel(p.source);
    events.push({ date: p.paidOn ?? labDay(p.createdAt), kind, invoiceId: p.invoiceId, description: `${label} — invoice #${number}`, amountCents: -p.appliedCents });
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.description.localeCompare(b.description));
}

/** A statement month's bounds, plus the day its balances are aged as of: the month's end, or today for the current month. */
function statementPeriod(month, generatedAt) {
  const { startIso, endIso, label } = monthBounds(month);
  const todayIso = isoDateIn(LAB_TIMEZONE, generatedAt);
  return { startIso, endIso, label, todayIso, asOfIso: todayIso < endIso ? todayIso : endIso };
}

const footerText = (todayIso, asOfIso, labName) => `Generated ${formatUsDate(todayIso)} · Aging as of ${formatUsDate(asOfIso)} · ${labName} · Pay online in the doctor portal.`;
const agingCells = (aging) => ({ ...aging, cells: AGING_BUCKETS.map((b) => [b.label, formatCents(aging.buckets[b.key])]) });

/**
 * A statement for one month: opening balance, every dated event in the month
 * with a running balance, closing balance, and the closing balance aged per
 * invoice as of the month's end (or today, for the current month). `client`
 * is the bill-to header: a practice (`{ practice, accountNumber }`) or a
 * doctor (loadClient). Pure; dates use the lab timezone.
 */
export function buildStatementModel(client, activity, period, { generatedAt, labName = labIdentity().name }) {
  const { startIso, endIso, label, todayIso, asOfIso } = statementPeriod(period.month, generatedAt);

  const events = statementEvents(activity);
  const openingCents = events.filter((e) => e.date < startIso).reduce((s, e) => s + e.amountCents, 0);
  let running = openingCents;
  const lines = events
    .filter((e) => e.date >= startIso && e.date <= endIso)
    .map((e) => {
      running += e.amountCents;
      return { ...e, balanceCents: running };
    });
  const closingCents = running;

  // Each invoice's balance as of the period end, aged by its due date.
  const paidBy = new Map();
  for (const p of activity.payments) {
    if ((p.paidOn ?? labDay(p.createdAt)) <= endIso) paidBy.set(p.invoiceId, (paidBy.get(p.invoiceId) ?? 0) + p.appliedCents);
  }
  const items = activity.invoices
    .filter((inv) => inv.issuedAt && labDay(inv.issuedAt) <= endIso)
    .filter((inv) => !(inv.status === "void" && inv.voidedAt && labDay(inv.voidedAt) <= endIso))
    .map((inv) => ({ dueDate: inv.dueDate ?? null, balanceCents: inv.totalCents - (paidBy.get(inv.id) ?? 0) }));
  const aging = ageBalances(items, asOfIso);

  return deepPrintable({
    title: `Statement — ${label}`,
    filename: `statement-${period.month}.pdf`,
    period: { month: period.month, label, startIso, endIso, asOfIso },
    billTo: billToLines(client),
    // What a combined statement titles this practice's section with.
    heading: { name: client?.practice || client?.name || "—", accountNumber: client?.accountNumber ?? null },
    openingCents,
    closingCents,
    summary: [["Opening balance", formatCents(openingCents)], ["Closing balance", formatCents(closingCents)]],
    lines: lines.map((l) => ({ ...l, cells: [formatUsDate(l.date), l.description, formatCents(l.amountCents), formatCents(l.balanceCents)] })),
    aging: agingCells(aging),
    footer: footerText(todayIso, asOfIso, labName),
  });
}

/**
 * The combined group statement (piece 11): one section per practice, each
 * under its own name and account number with its own opening, activity and
 * closing (the practice's statement model, unchanged), then the group total.
 * Every group figure is the sum of the sections in integer cents, so the
 * total can never disagree with the practices. Pure.
 * @param {{ id: string, name: string }} org
 * @param {object[]} perAccountModels buildStatementModel results for the group's practices, same month
 */
export function buildCombinedStatementModel(org, perAccountModels, { month, generatedAt, labName = labIdentity().name }) {
  const { startIso, endIso, label, todayIso, asOfIso } = statementPeriod(month, generatedAt);
  const sorted = [...perAccountModels].sort((a, b) => a.heading.name.localeCompare(b.heading.name) || String(a.heading.accountNumber ?? "").localeCompare(String(b.heading.accountNumber ?? "")));
  const sum = (pick) => sorted.reduce((s, m) => s + pick(m), 0);
  const openingCents = sum((m) => m.openingCents);
  const closingCents = sum((m) => m.closingCents);
  const buckets = Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, sum((m) => m.aging.buckets[b.key])]));
  const oldest = sorted.map((m) => m.aging.oldestDueDate).filter(Boolean).sort()[0] ?? null;
  return deepPrintable({
    title: `Combined statement — ${label}`,
    filename: `combined-statement-${month}.pdf`,
    period: { month, label, startIso, endIso, asOfIso },
    billTo: [org.name],
    openingCents,
    closingCents,
    activityCount: sum((m) => m.lines.length),
    summary: [["Group opening balance", formatCents(openingCents)], ["Group closing balance", formatCents(closingCents)]],
    sections: sorted.map((m) => ({
      heading: m.heading.accountNumber ? `${m.heading.name} · Account ${m.heading.accountNumber}` : m.heading.name,
      accountNumber: m.heading.accountNumber,
      openingCents: m.openingCents,
      closingCents: m.closingCents,
      summary: m.summary,
      lines: m.lines,
    })),
    aging: agingCells({ buckets, totalCents: sum((m) => m.aging.totalCents), oldestDueDate: oldest }),
    footer: footerText(todayIso, asOfIso, labName),
  });
}
