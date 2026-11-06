import { and, eq, inArray, isNull } from "drizzle-orm";
import { isoDateIn, LAB_TIMEZONE } from "@my-app/shared";
import { db } from "../../config/database.js";
import { statementSends } from "../../db/schema/index.js";
import { createId } from "../../lib/id.js";
import * as auditService from "../audit.service.js";
import { sendStatementNotice } from "../email.service.js";
import { activityByAccount, loadStatementActivity, practiceHeader, practiceStatementFor } from "./statements.service.js";
import { buildCombinedStatementModel, buildStatementModel, monthBounds } from "./statement-model.js";
import {
  assertSubjectKey, isPracticeStatementRecipient, loadStatementSubjects, practiceStatementRecipients, statementRecipients, subjectKeyOf,
} from "./statement-subjects.js";

/**
 * The monthly statement run (piece 10, R6; per practice since piece 11): one
 * "your statement is ready" notice per (subject, recipient, month), where the
 * subject is a practice (`account:<id>`, sent to its approved doctor members)
 * or a group's combined statement (`organization:<id>`, sent to the group's
 * admins only, when the group has `settings.combinedStatement`). Idempotent
 * through statement_sends: the run claims a row ("sending") BEFORE it emails,
 * so a crash, a retry or a double-click never sends the same month twice; a
 * "failed" or "no_email" row is re-taken by the next run. The single
 * per-practice action (sendStatementFor) re-sends on purpose. A statement is a
 * billing document every client gets, so this calls sendStatementNotice
 * directly, not the preference-aware notifier. Subjects and recipients:
 * statement-subjects.js.
 */

// A row is re-taken by the bulk run only when it never went out: a failed forced re-send of a
// delivered month keeps its sent_at and stays "already sent".
const RETRYABLE = ["failed", "no_email"];

/**
 * statement_sends access, always per subject: every lookup and write names
 * `subjectKey` ("account:<id>" | "organization:<id>"), so a practice's send
 * and a group's send to the same person never collide, and a row the practice
 * backfill rewrote to `account:<id>` is the row a re-send finds. The run takes
 * it as a dependency so its idempotency can be tested without a database.
 */
export const statementSendsStore = {
  async forMonth(database, month) {
    return database
      .select({ subjectKey: statementSends.subjectKey, clientUserId: statementSends.clientUserId, status: statementSends.status, sentAt: statementSends.sentAt })
      .from(statementSends)
      .where(eq(statementSends.month, month));
  },
  /** The row id when this caller now owns the (subject, recipient, month) send, else null (another run holds or sent it). */
  async claim(database, { subjectKey, clientUserId, month, closingCents, byUserId = null, runId = null }) {
    assertSubjectKey(subjectKey);
    const [row] = await database
      .insert(statementSends)
      .values({ id: createId(), subjectKey, clientUserId, month, closingCents, status: "sending", sentBy: byUserId, runId })
      .onConflictDoNothing({ target: [statementSends.subjectKey, statementSends.clientUserId, statementSends.month] })
      .returning({ id: statementSends.id });
    if (row) return row.id;
    const [retaken] = await database
      .update(statementSends)
      .set({ status: "sending", closingCents, sentBy: byUserId, runId, updatedAt: new Date() })
      .where(and(
        eq(statementSends.subjectKey, subjectKey), eq(statementSends.clientUserId, clientUserId), eq(statementSends.month, month),
        inArray(statementSends.status, RETRYABLE), isNull(statementSends.sentAt),
      ))
      .returning({ id: statementSends.id });
    return retaken?.id ?? null;
  },
  /** The single action: take the row whatever its state (an explicit re-send). */
  async forceClaim(database, { subjectKey, clientUserId, month, closingCents, byUserId = null }) {
    assertSubjectKey(subjectKey);
    const [row] = await database
      .insert(statementSends)
      .values({ id: createId(), subjectKey, clientUserId, month, closingCents, status: "sending", sentBy: byUserId, runId: null })
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
  async recordNoEmail(database, { subjectKey, clientUserId, month, closingCents, byUserId = null, runId = null }) {
    assertSubjectKey(subjectKey);
    await database
      .insert(statementSends)
      .values({ id: createId(), subjectKey, clientUserId, month, closingCents, status: "no_email", sentBy: byUserId, runId })
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
 * Who gets a notice, by row key ("<subjectKey>|<recipientUserId>"). Pure.
 * Order of reasons: already sent (delivered at least once), unconfirmed
 * (claimed "sending" and never settled: the email may have gone out before a
 * crash, so staff check and use the single send; the bulk run never re-takes
 * it), nothing to say (no activity and a zero closing), no address.
 * @returns {{ send: string[], skip: { id: string, reason: "already_sent"|"unconfirmed"|"no_activity"|"no_email" }[] }}
 */
export function planStatementRun({ candidates, onlyKeys }) {
  const only = onlyKeys ? new Set(onlyKeys) : null;
  const send = [];
  const skip = [];
  for (const c of candidates) {
    if (only && !only.has(c.key)) continue;
    const id = c.key;
    if (c.alreadySentAt) skip.push({ id, reason: "already_sent" });
    else if (c.sendStatus === "sending") skip.push({ id, reason: "unconfirmed" });
    else if (!c.activityCount && !c.closingCents) skip.push({ id, reason: "no_activity" });
    else if (!c.email) skip.push({ id, reason: "no_email" });
    else send.push(id);
  }
  return { send, skip };
}

/** items → Map(key → [value]), appending in place. */
function groupBy(items, keyOf) {
  const out = new Map();
  for (const item of items) {
    const k = keyOf(item);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(item);
  }
  return out;
}

/** A preview row's key: one per (subject, recipient). What the run's `keys` select. */
export const statementRowKey = (subjectKey, recipientUserId) => `${subjectKey}|${recipientUserId}`;

/**
 * Preview rows from preloaded data (loadStatementSubjects + one activity load). Pure.
 *  - one row per (practice, approved doctor member), for each practice with
 *    activity in the month or a non-zero closing: that practice's statement,
 *    under its own name and account number;
 *  - one row per (group, active admin), only for a group with
 *    `settings.combinedStatement`: the combined statement (the sum of its
 *    practices'). No practice member is ever a recipient of a group row.
 * A legacy statement_sends row (subject_key '', written before the practice
 * backfill) counts for that recipient's practice rows only, so a month sent
 * before the backfill is never sent again.
 */
export function buildStatementCandidates({ accounts, members, organizations, activity, sends, month, generatedAt = new Date() }) {
  const byAccount = activityByAccount(activity, accounts.map((a) => a.id));
  const models = new Map(accounts.map((a) => [a.id, buildStatementModel(practiceHeader(a), byAccount.get(a.id), { month }, { generatedAt })]));
  const recipientsBy = groupBy(members.filter(isPracticeStatementRecipient), (m) => m.accountId);
  const sendBy = new Map(sends.filter((s) => s.subjectKey).map((s) => [statementRowKey(s.subjectKey, s.clientUserId), s]));
  const legacyBy = new Map(sends.filter((s) => !s.subjectKey).map((s) => [s.clientUserId, s]));

  const rows = [];
  const addRows = (subject, subjectId, recipients, { name, accountNumber, model, activityCount }) => {
    if (!activityCount && !model.closingCents) return;
    const subjectKey = subjectKeyOf(subject, subjectId);
    for (const r of recipients) {
      const key = statementRowKey(subjectKey, r.userId);
      const sent = sendBy.get(key) ?? (subject === "account" ? legacyBy.get(r.userId) : undefined);
      rows.push({
        key, subject, subjectId, subjectKey, recipientUserId: r.userId, recipientName: r.name ?? null, email: r.email || null,
        name: name ?? null, accountNumber: accountNumber ?? null,
        openingCents: model.openingCents, closingCents: model.closingCents, activityCount,
        alreadySentAt: sent?.sentAt ?? null, sendStatus: sent?.status ?? null, // any delivery, even before a failed re-send
      });
    }
  };
  for (const a of accounts) {
    const model = models.get(a.id);
    addRows("account", a.id, recipientsBy.get(a.id) ?? [], { name: a.name, accountNumber: a.accountNumber, model, activityCount: model.lines.length });
  }
  for (const o of organizations) {
    if (o.settings?.combinedStatement !== true) continue;
    const model = buildCombinedStatementModel(o, o.accountIds.map((id) => models.get(id)).filter(Boolean), { month, generatedAt });
    const admins = (o.admins ?? []).filter((a) => a.status === "active");
    addRows("organization", o.id, admins, { name: o.name, accountNumber: null, model, activityCount: model.activityCount });
  }
  const plan = planStatementRun({ candidates: rows });
  const planned = new Map([...plan.send.map((id) => [id, "send"]), ...plan.skip.map((s) => [s.id, s.reason])]);
  return rows.map((r) => ({ ...r, planned: planned.get(r.key) }));
}

/** GET /admin/statements/run: one row per (subject, recipient) due a statement for `month`. One activity load for every practice. */
export async function previewStatementRun(month, database = db, { store = statementSendsStore, generatedAt = new Date(), loadSubjects = loadStatementSubjects } = {}) {
  monthBounds(month); // throws on a malformed month
  const subjects = await loadSubjects(database);
  if (!subjects.accounts.length) return [];
  const activity = await loadStatementActivity(subjects.accounts.map((a) => a.id), database);
  const sends = await store.forMonth(database, month);
  return buildStatementCandidates({ ...subjects, activity, sends, month, generatedAt });
}

/** Send one claimed notice and settle its row. Never throws: a failure is recorded and retried by the next run. */
async function deliver({ sendId, to, subjectKey, clientUserId, month, monthLabel, closingCents, byUserId, runId, ipAddress = null }, { database, store, send }) {
  let sent = false;
  try {
    sent = Boolean(await send({ to, monthLabel, closingCents, combined: subjectKey.startsWith("organization:") }));
  } catch (err) {
    console.error(`[STATEMENT] send failed for ${subjectKey} ${clientUserId} ${month}: ${String(err?.message || err)}`);
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
      metadata: { month, subjectKey, closingCents, runId: runId ?? null, sent }, ipAddress,
    }, database);
  } catch (err) {
    console.error(`[AUDIT] statement.emailed write failed: ${String(err?.message || err)}`);
  }
  return sent;
}

/**
 * POST /admin/statements/run and the monthly job. Sequential; each row is
 * claimed before its email. `keys` (preview row keys) limits the run to those
 * rows. A dry run plans only.
 * @returns {{ sent: number, skipped: number, failed: number, skippedBy: Record<string, number>, dryRun?: true, wouldSend?: number }}
 */
export async function runStatements(
  { month, keys, byUserId = null, runId = null, dryRun = false },
  { database = db, store = statementSendsStore, send = sendStatementNotice, generatedAt = new Date(), loadSubjects } = {},
) {
  const rows = await previewStatementRun(month, database, { store, generatedAt, ...(loadSubjects ? { loadSubjects } : {}) });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const plan = planStatementRun({ candidates: rows, onlyKeys: keys });
  const skippedBy = {};
  const skipped = (reason) => { skippedBy[reason] = (skippedBy[reason] ?? 0) + 1; };
  plan.skip.forEach((s) => skipped(s.reason));
  if (dryRun) return { dryRun: true, wouldSend: plan.send.length, sent: 0, failed: 0, skipped: plan.skip.length, skippedBy };

  const claimOf = (row) => ({ subjectKey: row.subjectKey, clientUserId: row.recipientUserId, month, closingCents: row.closingCents, byUserId, runId });
  for (const s of plan.skip) {
    if (s.reason === "no_email") await store.recordNoEmail(database, claimOf(byKey.get(s.id)));
  }
  const { label: monthLabel } = monthBounds(month);
  let sent = 0;
  let failed = 0;
  for (const key of plan.send) {
    const row = byKey.get(key);
    const sendId = await store.claim(database, claimOf(row));
    if (!sendId) { skipped("already_sent"); continue; }
    const ok = await deliver({ sendId, to: row.email, subjectKey: row.subjectKey, clientUserId: row.recipientUserId, month, monthLabel, closingCents: row.closingCents, byUserId, runId },
      { database, store, send });
    if (ok) sent += 1; else failed += 1;
  }
  return { sent, failed, skipped: Object.values(skippedBy).reduce((a, b) => a + b, 0), skippedBy };
}

/**
 * The per-practice "Email statement" action: the practice's statement for
 * `month`, sent now to `recipientUserIds` (an admin naming one person: the
 * per-client wrapper) or else to every approved doctor member. `force` (the
 * default) re-sends a month already sent and overwrites sent_at; without it
 * the bulk run's claim rule applies.
 * → null (not an active practice), or
 *   { closingCents, results: [{ recipientUserId, status: "sent"|"failed"|"no_email"|"already_sent" }] }.
 */
export async function sendStatementFor({ accountId, recipientUserIds = null }, month, { byUserId = null, force = true, runId = null, ipAddress = null } = {},
  { database = db, store = statementSendsStore, send = sendStatementNotice, generatedAt = new Date() } = {}) {
  const model = await practiceStatementFor(accountId, month, { generatedAt }, database);
  if (!model) return null;
  const { closingCents } = model;
  const subjectKey = subjectKeyOf("account", accountId);
  const recipients = recipientUserIds ? await statementRecipients(recipientUserIds, database) : await practiceStatementRecipients(accountId, database);
  const results = [];
  for (const person of recipients) {
    const result = (status) => results.push({ recipientUserId: person.id, status });
    if (!person.email) { result("no_email"); continue; }
    const claim = { subjectKey, clientUserId: person.id, month, closingCents, byUserId, runId };
    const sendId = force ? await store.forceClaim(database, claim) : await store.claim(database, claim);
    if (!sendId) { result("already_sent"); continue; }
    const ok = await deliver({ sendId, to: person.email, subjectKey, clientUserId: person.id, month, monthLabel: model.period.label, closingCents, byUserId, runId, ipAddress },
      { database, store, send });
    result(ok ? "sent" : "failed");
  }
  return { closingCents, results };
}
