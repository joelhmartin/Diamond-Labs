import { and, eq, inArray, isNotNull, lt, ne } from "drizzle-orm";
import { isoDateIn, LAB_TIMEZONE } from "@my-app/shared";
import { db } from "../../config/database.js";
import { accounts, invoices, invoicePayments, labOrders, users, doctorProfiles } from "../../db/schema/index.js";
import { openReceivableInvoices, ledgerRowDayBetween } from "./ledger.service.js";
import { afterLabDay } from "../../lib/lab-day-sql.js";
import { buildReceivables } from "./aging.js";
import { buildStatementModel, buildCombinedStatementModel } from "./statement-model.js";
import { renderStatementPdf, renderCombinedStatementPdf } from "./billing-pdf.js";

/**
 * Statements and accounts receivable. A statement is per practice (a client
 * account, piece 11): it covers the invoices whose account_id is that
 * practice, and is headed with the practice's name and account number. A
 * group with `settings.combinedStatement` also has a combined statement: a
 * section per practice and a group total. Guest shop invoices (no account)
 * never reach a statement or the AR page.
 */

/** The doctor's bill-to and ship-to block (statements, invoices, the Ship form), or null when the user isn't a doctor. */
export async function loadClient(clientUserId, database = db) {
  const [row] = await database
    .select({
      id: users.id, name: users.name, email: users.email, role: users.role, accountNumber: users.seazonaAccountNumber,
      seazonaClientId: users.seazonaClientId, profile: doctorProfiles,
    })
    .from(users)
    .leftJoin(doctorProfiles, eq(doctorProfiles.userId, users.id))
    .where(eq(users.id, clientUserId));
  if (!row || row.role !== "doctor") return null;
  const p = row.profile;
  return {
    id: row.id, name: row.name, email: row.email, accountNumber: row.accountNumber ?? null, seazonaClientId: row.seazonaClientId ?? null,
    practice: p?.companyName ?? null, address1: p?.address1 ?? null, address2: p?.address2 ?? null,
    city: p?.city ?? null, state: p?.state ?? null, zip: p?.zip ?? null,
    phone: p?.phone ?? null, deliveryMethod: p?.deliveryMethod ?? null, deliveryNotes: p?.deliveryNotes ?? null,
  };
}

/**
 * The WHERE clauses of loadStatementActivity. `accountIds` are the practices
 * covered; `null` means every owned invoice (the statements summary report).
 * `through` ("YYYY-MM-DD") keeps only invoices issued, and ledger rows dated
 * (ledgerRowDay), on or before that lab-local day; everything earlier still
 * loads, so opening balances stay whole. A void after `through` is dated by
 * voidedAt and falls outside the period on its own (statementEvents).
 */
export function statementActivityFilters(accountIds, { through } = {}) {
  const invoiceScope = and(
    accountIds === null ? isNotNull(invoices.clientUserId) : inArray(invoices.accountId, accountIds),
    ne(invoices.status, "draft"),
    through ? lt(invoices.issuedAt, afterLabDay(through)) : undefined,
  );
  const paymentBound = through ? ledgerRowDayBetween({ to: through }) : undefined;
  return { invoiceScope, paymentBound };
}

/**
 * Every money event on these practices' invoices (statement-model's
 * `activity`); each invoice carries its accountId so one load can be split
 * per practice. Drafts carry none. `accountIds = null` means every client's
 * invoices (the statements summary report); the payments are then joined,
 * not listed by id, so the query does not grow with the invoice count.
 * `{ through }` bounds it (statementActivityFilters).
 */
export async function loadStatementActivity(accountIds, database = db, { through } = {}) {
  if (Array.isArray(accountIds) && accountIds.length === 0) return { invoices: [], payments: [] };
  const { invoiceScope: scope, paymentBound } = statementActivityFilters(accountIds, { through });
  const invs = await database
    .select({
      id: invoices.id, clientUserId: invoices.clientUserId, accountId: invoices.accountId, invoiceNumber: invoices.invoiceNumber, status: invoices.status, totalCents: invoices.totalCents,
      kind: invoices.kind, legacySeazonaInvoiceId: invoices.legacySeazonaInvoiceId,
      issuedAt: invoices.issuedAt, voidedAt: invoices.voidedAt, dueDate: invoices.dueDate, labOrderNumber: labOrders.orderNumber,
    })
    .from(invoices)
    .leftJoin(labOrders, eq(labOrders.id, invoices.labOrderId))
    .where(scope);
  const payments = invs.length
    ? await database
        .select({
          invoiceId: invoicePayments.invoiceId, invoiceNumber: invoicePayments.invoiceNumber, appliedCents: invoicePayments.appliedCents,
          source: invoicePayments.source, paidOn: invoicePayments.paidOn, createdAt: invoicePayments.createdAt,
        })
        .from(invoicePayments)
        // The same invoice filter as above by join, not an id list: no bind-parameter ceiling on a large ledger.
        .innerJoin(invoices, eq(invoices.id, invoicePayments.invoiceId))
        .where(and(scope, paymentBound))
    : [];
  return { invoices: invs, payments };
}

/**
 * Active practices (client accounts) with what their statement is headed
 * with: name, lab account number and the account OWNER's doctor-profile
 * address (none when the owner has no profile). `ids = null` → every active
 * practice (the monthly run). THE one source of a practice statement's
 * header, so the run, the admin download and the portal download agree.
 * @returns {Promise<{ id, name, accountNumber, address1, address2, city, state, zip }[]>}
 */
export async function loadStatementPractices(database = db, ids = null) {
  if (Array.isArray(ids) && ids.length === 0) return [];
  const rows = await database
    .select({
      id: accounts.id, name: accounts.name, accountNumber: accounts.accountNumber,
      address1: doctorProfiles.address1, address2: doctorProfiles.address2, city: doctorProfiles.city, state: doctorProfiles.state, zip: doctorProfiles.zip,
    })
    .from(accounts)
    .leftJoin(doctorProfiles, eq(doctorProfiles.userId, accounts.ownerId))
    .where(and(eq(accounts.status, "active"), eq(accounts.isClient, true), ids ? inArray(accounts.id, [...new Set(ids)]) : undefined));
  return rows.map((r) => ({
    id: r.id, name: r.name, accountNumber: r.accountNumber ?? null,
    address1: r.address1 ?? null, address2: r.address2 ?? null, city: r.city ?? null, state: r.state ?? null, zip: r.zip ?? null,
  }));
}

/** A practice's bill-to header (statement-model's `client`, printed by billToLines): name, account number, owner's address. */
export const practiceHeader = (p) => ({
  practice: p.name, accountNumber: p.accountNumber ?? null,
  address1: p.address1 ?? null, address2: p.address2 ?? null, city: p.city ?? null, state: p.state ?? null, zip: p.zip ?? null,
});

/** Split one activity load per practice: Map(accountId → { invoices, payments }), one entry per id given. */
export function activityByAccount(activity, accountIds) {
  const out = new Map(accountIds.map((id) => [id, { invoices: [], payments: [] }]));
  const accountOf = new Map();
  for (const inv of activity.invoices) {
    const bucket = out.get(inv.accountId);
    if (!bucket) continue;
    bucket.invoices.push(inv);
    accountOf.set(inv.id, inv.accountId);
  }
  for (const p of activity.payments) out.get(accountOf.get(p.invoiceId))?.payments.push(p);
  return out;
}

/**
 * A statement for a month covering `accountIds`, headed `header` (statement-model's
 * `client`: a practice header, practiceHeader). → the statement model.
 */
export async function statementFor({ accountIds, header }, month, { generatedAt = new Date() } = {}, database = db) {
  return buildStatementModel(header, await loadStatementActivity(accountIds, database), { month }, { generatedAt });
}

/** One practice's statement model, or null when `accountId` is not an active practice. */
export async function practiceStatementFor(accountId, month, { generatedAt = new Date() } = {}, database = db) {
  const [practice] = await loadStatementPractices(database, [accountId]);
  if (!practice) return null;
  return statementFor({ accountIds: [accountId], header: practiceHeader(practice) }, month, { generatedAt }, database);
}

/**
 * A group's combined statement model: each of `org.accountIds` that is an
 * active practice gets its own section (its own statement, one activity load
 * for all), then the group total (buildCombinedStatementModel). The group is
 * billed by name only: it has no single owner, so no address.
 * @param {{ id: string, name: string, accountIds: string[] }} org
 */
export async function combinedStatementFor(org, month, { generatedAt = new Date() } = {}, database = db) {
  const practices = await loadStatementPractices(database, org.accountIds);
  const ids = practices.map((p) => p.id);
  const byAccount = activityByAccount(await loadStatementActivity(ids, database), ids);
  const models = practices.map((p) => buildStatementModel(practiceHeader(p), byAccount.get(p.id), { month }, { generatedAt }));
  return buildCombinedStatementModel(org, models, { month, generatedAt });
}

/**
 * The statement PDF for a subject (built on request, never stored), or null
 * when the practice is not an active practice:
 *   { subject: "account", subjectId }                        one practice
 *   { subject: "organization", organization: { id, name, accountIds } }  the combined statement
 */
export async function statementPdfFor(subject, month, database = db) {
  if (subject.subject === "organization") {
    const model = await combinedStatementFor(subject.organization, month, {}, database);
    return { model, pdf: await renderCombinedStatementPdf(model) };
  }
  const model = await practiceStatementFor(subject.subjectId, month, {}, database);
  return model ? { model, pdf: await renderStatementPdf(model) } : null;
}

/**
 * Admin › Accounts receivable as of the lab's today: every issued client
 * invoice, its balance from the ledger's one paid-sum and balance rule
 * (deriveBalance, summed in SQL by openReceivableInvoices), aged and grouped per client (clientUserId). Grouping by
 * practice where seazonaClientId is shared is deferred to piece 5's practice
 * entity: every row action (invoice filter, statement PDF, statement email)
 * is per user today. Spec correction 6. `today` ("YYYY-MM-DD", default the
 * lab's today now) lets a report age against its run clock; it is a separate
 * argument so a route passing its query object can never set it.
 */
export async function listReceivables({ pastDueOnly = false } = {}, database = db, { today } = {}) {
  const open = await openReceivableInvoices(database);
  const clients = await loadClientNames(open.map((i) => i.clientUserId), database);
  return buildReceivables(open, clients, today ?? isoDateIn(LAB_TIMEZONE, new Date()), { pastDueOnly });
}

/**
 * Many clients' name, practice and account number in one query (the bulk
 * sibling of loadClient), keyed by user id. Null/blank ids (an unowned legacy
 * invoice has no client yet) are skipped.
 * @returns {Promise<Map<string, { id, name, accountNumber, practice }>>}
 */
export async function loadClientNames(clientUserIds, database = db) {
  const ids = [...new Set(clientUserIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await database
    .select({ id: users.id, name: users.name, accountNumber: users.seazonaAccountNumber, practice: doctorProfiles.companyName })
    .from(users)
    .leftJoin(doctorProfiles, eq(doctorProfiles.userId, users.id))
    .where(inArray(users.id, ids));
  return new Map(rows.map((c) => [c.id, c]));
}
