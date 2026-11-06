import { and, eq, inArray, isNull } from "drizzle-orm";
import { isoDateIn, LAB_TIMEZONE } from "@my-app/shared";
import { db } from "../../config/database.js";
import { users, doctorProfiles, statementSends } from "../../db/schema/index.js";
import { createId } from "../../lib/id.js";
import * as auditService from "../audit.service.js";
import { sendStatementNotice } from "../email.service.js";
import { loadStatementActivity, statementFor } from "./statements.service.js";
import { buildStatementModel, monthBounds } from "./statement-model.js";

/**
 * The monthly statement run (piece 10, R6): one "your statement is ready"
 * notice per client user for a month, idempotent per (client, month) through
 * statement_sends. The run claims a client's row ("sending") BEFORE it emails,
 * so a crash, a retry or a double-click never sends the same month twice; a
 * "failed" or "no_email" row is re-taken by the next run. The single
 * per-client action (sendStatementFor) re-sends on purpose. A statement is a
 * billing document every client gets, so this calls sendStatementNotice
 * directly, not the preference-aware notifier.
 */

// A row is re-taken by the bulk run only when it never went out: a failed forced re-send of a
// delivered month keeps its sent_at and stays "already sent".
const RETRYABLE = ["failed", "no_email"];

/** statement_sends access. The run takes it as a dependency so its idempotency can be tested without a database. */
export const statementSendsStore = {
  async forMonth(database, month) {
    return database
      .select({ clientUserId: statementSends.clientUserId, status: statementSends.status, sentAt: statementSends.sentAt })
      .from(statementSends)
      .where(eq(statementSends.month, month));
  },
  /** The row id when this caller now owns the (client, month) send, else null (another run holds or sent it). */
  async claim(database, { clientUserId, month, closingCents, byUserId = null, runId = null }) {
    const [row] = await database
      .insert(statementSends)
      .values({ id: createId(), clientUserId, month, closingCents, status: "sending", sentBy: byUserId, runId })
      .onConflictDoNothing({ target: [statementSends.subjectKey, statementSends.clientUserId, statementSends.month] })
      .returning({ id: statementSends.id });
    if (row) return row.id;
    const [retaken] = await database
      .update(statementSends)
      .set({ status: "sending", closingCents, sentBy: byUserId, runId, updatedAt: new Date() })
      .where(and(eq(statementSends.clientUserId, clientUserId), eq(statementSends.month, month), inArray(statementSends.status, RETRYABLE), isNull(statementSends.sentAt)))
      .returning({ id: statementSends.id });
    return retaken?.id ?? null;
  },
  /** The single action: take the row whatever its state (an explicit re-send). */
  async forceClaim(database, { clientUserId, month, closingCents, byUserId = null }) {
    const [row] = await database
      .insert(statementSends)
      .values({ id: createId(), clientUserId, month, closingCents, status: "sending", sentBy: byUserId, runId: null })
      .onConflictDoUpdate({
        target: [statementSends.subjectKey, statementSends.clientUserId, statementSends.month],
        set: { status: "sending", closingCents, sentBy: byUserId, runId: null, updatedAt: new Date() },
      })
      .returning({ id: statementSends.id });
    return row.id;
  },
  async finish(database, id, { status, sentAt = null }) {
    await database.update(statementSends).set({ status, ...(sentAt ? { sentAt } : {}), updatedAt: new Date() }).where(eq(statementSends.id, id));
  },
  async recordNoEmail(database, { clientUserId, month, closingCents, byUserId = null, runId = null }) {
    await database
      .insert(statementSends)
      .values({ id: createId(), clientUserId, month, closingCents, status: "no_email", sentBy: byUserId, runId })
      .onConflictDoNothing({ target: [statementSends.subjectKey, statementSends.clientUserId, statementSends.month] });
  },
};

/** The lab-local month before `now`'s, as YYYY-MM (what the monthly job runs). */
export function previousLabMonth(now = new Date()) {
  const [y, m] = isoDateIn(LAB_TIMEZONE, now).split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}

/**
 * True when `month` is the lab's current month or later: not closed yet, so the
 * bulk run refuses it (a mid-month notice would freeze a partial statement as
 * "sent" and the real one would never go out). The single send is not limited.
 */
export function openMonth(month, now = new Date()) {
  return month >= isoDateIn(LAB_TIMEZONE, now).slice(0, 7);
}

/**
 * Who gets a notice. Pure. Order of reasons: already sent (delivered at least
 * once), unconfirmed (claimed "sending" and never settled: the email may have
 * gone out before a crash, so staff check and use the single send; the bulk run
 * never re-takes it), nothing to say (no activity and a zero closing), no address.
 * @returns {{ send: string[], skip: { id: string, reason: "already_sent"|"unconfirmed"|"no_activity"|"no_email" }[] }}
 */
export function planStatementRun({ candidates, onlyIds }) {
  const only = onlyIds ? new Set(onlyIds) : null;
  const send = [];
  const skip = [];
  for (const c of candidates) {
    if (only && !only.has(c.clientUserId)) continue;
    const id = c.clientUserId;
    if (c.alreadySentAt) skip.push({ id, reason: "already_sent" });
    else if (c.sendStatus === "sending") skip.push({ id, reason: "unconfirmed" });
    else if (!c.activityCount && !c.closingCents) skip.push({ id, reason: "no_activity" });
    else if (!c.email) skip.push({ id, reason: "no_email" });
    else send.push(id);
  }
  return { send, skip };
}

/** items → Map(key → [value]), appending in place. */
function groupBy(items, keyOf, valueOf = (x) => x) {
  const out = new Map();
  for (const item of items) {
    const k = keyOf(item);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(valueOf(item));
  }
  return out;
}

/**
 * The doctors whose invoices a statement covers: everyone sharing the user's
 * non-null seazonaClientId (one practice, the pre-piece-11 rule), else just
 * the user. Always includes the user. Moved here from the ledger in Task 5,
 * where every payment and invoice read went onto the client scope; Task 7
 * replaces it with per-account statements and deletes it (the allow-list in
 * routes/__tests__/no-seazona-authz.test.js keeps this file until then).
 */
async function practiceUserIds(user, database = db) {
  if (!user?.seazonaClientId) return [user.id];
  const rows = await database
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.seazonaClientId, String(user.seazonaClientId)), eq(users.role, "doctor")));
  return [...new Set([...rows.map((r) => r.id), user.id])];
}

/** The doctor's own statement download (GET /invoices/statement.pdf) covers the same doctors as the emailed one. Task 7 moves it onto the account scope. */
export function doctorStatementUserIds(user, database = db) {
  return practiceUserIds(user, database);
}

/** A practice is every doctor sharing a non-null seazonaClientId (the rule practiceUserIds applies), else the user alone. */
const practiceKey = (d) => (d.seazonaClientId ? `p:${d.seazonaClientId}` : `u:${d.id}`);

/**
 * Preview rows from preloaded data. Pure. Each client's statement covers their
 * practice, the same figure the single send and the client's own download show.
 * Candidates are approved doctors with activity in the month or a non-zero closing.
 */
export function buildStatementCandidates({ doctors, activity, sends, month, generatedAt = new Date() }) {
  const practices = groupBy(doctors, practiceKey, (d) => d.id);
  const invoicesBy = groupBy(activity.invoices, (inv) => inv.clientUserId);
  const paymentsBy = groupBy(activity.payments, (p) => p.invoiceId);
  const sendBy = new Map(sends.map((s) => [s.clientUserId, s]));

  const rows = [];
  for (const d of doctors) {
    if (d.approvalStatus !== "approved") continue;
    const invs = practices.get(practiceKey(d)).flatMap((id) => invoicesBy.get(id) ?? []);
    const payments = invs.flatMap((i) => paymentsBy.get(i.id) ?? []);
    const model = buildStatementModel(d, { invoices: invs, payments }, { month }, { generatedAt });
    const activityCount = model.lines.length;
    if (!activityCount && !model.closingCents) continue;
    const sent = sendBy.get(d.id);
    rows.push({
      clientUserId: d.id, name: d.name ?? null, practice: d.practice ?? null, accountNumber: d.accountNumber ?? null, email: d.email || null,
      openingCents: model.openingCents, closingCents: model.closingCents, activityCount,
      alreadySentAt: sent?.sentAt ?? null, sendStatus: sent?.status ?? null, // any delivery, even before a failed re-send
    });
  }
  const plan = planStatementRun({ candidates: rows });
  const planned = new Map([...plan.send.map((id) => [id, "send"]), ...plan.skip.map((s) => [s.id, s.reason])]);
  return rows.map((r) => ({ ...r, planned: planned.get(r.clientUserId) }));
}

/** GET /admin/statements/run: one row per client due a statement for `month`. One activity load for everyone. */
export async function previewStatementRun(month, database = db, { store = statementSendsStore, generatedAt = new Date() } = {}) {
  monthBounds(month); // throws on a malformed month
  const doctors = await database
    .select({
      id: users.id, name: users.name, email: users.email, accountNumber: users.seazonaAccountNumber,
      practice: doctorProfiles.companyName, seazonaClientId: users.seazonaClientId, approvalStatus: users.approvalStatus,
    })
    .from(users)
    .leftJoin(doctorProfiles, eq(doctorProfiles.userId, users.id))
    .where(eq(users.role, "doctor"));
  if (!doctors.length) return [];
  const activity = await loadStatementActivity(doctors.map((d) => d.id), database);
  const sends = await store.forMonth(database, month);
  return buildStatementCandidates({ doctors, activity, sends, month, generatedAt });
}

/** Send one claimed notice and settle its row. Never throws: a failure is recorded and retried by the next run. */
async function deliver({ sendId, to, clientUserId, month, monthLabel, closingCents, byUserId, runId, ipAddress = null }, { database, store, send }) {
  let sent = false;
  try {
    sent = Boolean(await send({ to, monthLabel, closingCents }));
  } catch (err) {
    console.error(`[STATEMENT] send failed for ${clientUserId} ${month}: ${String(err?.message || err)}`);
  }
  try {
    await store.finish(database, sendId, sent ? { status: "sent", sentAt: new Date() } : { status: "failed" });
  } catch (err) {
    // The row stays "sending", which the bulk run never re-takes: safe, and the batch carries on.
    console.error(`[STATEMENT] could not settle send ${sendId}: ${String(err?.message || err)}`);
  }
  try {
    await auditService.log({
      userId: byUserId ?? null, action: "statement.emailed", targetType: "user", targetId: clientUserId,
      metadata: { month, closingCents, runId: runId ?? null, sent }, ipAddress,
    }, database);
  } catch (err) {
    console.error(`[AUDIT] statement.emailed write failed: ${String(err?.message || err)}`);
  }
  return sent;
}

/**
 * POST /admin/statements/run and the monthly job. Sequential; each client's
 * row is claimed before its email. A dry run plans only.
 * @returns {{ sent: number, skipped: number, failed: number, skippedBy: Record<string, number>, dryRun?: true, wouldSend?: number }}
 */
export async function runStatements(
  { month, clientUserIds, byUserId = null, runId = null, dryRun = false },
  { database = db, store = statementSendsStore, send = sendStatementNotice, generatedAt = new Date() } = {},
) {
  const rows = await previewStatementRun(month, database, { store, generatedAt });
  const byId = new Map(rows.map((r) => [r.clientUserId, r]));
  const plan = planStatementRun({ candidates: rows, onlyIds: clientUserIds });
  const skippedBy = {};
  const skipped = (reason) => { skippedBy[reason] = (skippedBy[reason] ?? 0) + 1; };
  plan.skip.forEach((s) => skipped(s.reason));
  if (dryRun) return { dryRun: true, wouldSend: plan.send.length, sent: 0, failed: 0, skipped: plan.skip.length, skippedBy };

  for (const s of plan.skip) {
    if (s.reason === "no_email") await store.recordNoEmail(database, { clientUserId: s.id, month, closingCents: byId.get(s.id).closingCents, byUserId, runId });
  }
  const { label: monthLabel } = monthBounds(month);
  let sent = 0;
  let failed = 0;
  for (const id of plan.send) {
    const row = byId.get(id);
    const sendId = await store.claim(database, { clientUserId: id, month, closingCents: row.closingCents, byUserId, runId });
    if (!sendId) { skipped("already_sent"); continue; }
    const ok = await deliver({ sendId, to: row.email, clientUserId: id, month, monthLabel, closingCents: row.closingCents, byUserId, runId }, { database, store, send });
    if (ok) sent += 1; else failed += 1;
  }
  return { sent, failed, skipped: Object.values(skippedBy).reduce((a, b) => a + b, 0), skippedBy };
}

/**
 * The per-client "Email statement" action: the practice's statement for
 * `month`, sent now. `force` (the default) re-sends a month already sent and
 * overwrites sent_at; without it the bulk run's claim rule applies.
 * → null (not a doctor), or { status: "sent"|"failed"|"no_email"|"already_sent", closingCents }.
 */
export async function sendStatementFor(clientUserId, month, { byUserId = null, force = true, runId = null, ipAddress = null } = {},
  { database = db, store = statementSendsStore, send = sendStatementNotice } = {}) {
  const [target] = await database.select({ id: users.id, seazonaClientId: users.seazonaClientId }).from(users).where(eq(users.id, clientUserId));
  if (!target) return null;
  const out = await statementFor(clientUserId, month, { clientUserIds: await practiceUserIds(target, database) }, database);
  if (!out) return null;
  const { closingCents } = out.model;
  if (!out.client.email) return { status: "no_email", closingCents };
  const claim = { clientUserId, month, closingCents, byUserId, runId };
  const sendId = force ? await store.forceClaim(database, claim) : await store.claim(database, claim);
  if (!sendId) return { status: "already_sent", closingCents };
  const ok = await deliver({ sendId, to: out.client.email, clientUserId, month, monthLabel: out.model.period.label, closingCents, byUserId, runId, ipAddress }, { database, store, send });
  return { status: ok ? "sent" : "failed", closingCents };
}
