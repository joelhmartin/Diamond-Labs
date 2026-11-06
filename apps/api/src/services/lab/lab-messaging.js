import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { isStaffRole } from "@my-app/shared";
import { accounts, doctorProfiles, labOrders, memberships, pickups, rxCases, users } from "../../db/schema/index.js";
import { containsPattern, prefixPattern } from "../../lib/list-query.js";
import { requireClientPortal } from "../client-scope.js";
import { createMessaging } from "../../modules/messaging/index.js";
import * as recordFiles from "../../modules/record-files/index.js";
import * as auditService from "../audit.service.js";
import { markReadFor as markReadSeam, notify as notifySeam } from "../notify-seam.js";
import { assertNamedPartyKey, newPartyKey, parsePartyKey, partyKeysFor, practiceKeyFor, practiceLabel } from "../practice.js";

/**
 * Lab glue for the generic messaging module: lab staff are the host, a
 * doctor's practice (services/practice.js keys) is the party. This file owns
 * the record resolvers (Rx case, lab order, pickup), the party and author
 * labels, search, the staff "New message" picker, the route guard, the
 * message.received alert (and clearing it on open) and attachment storage (record-files). Boot (services/app-modules.js) wires it once.
 *
 * Visibility is the client scope restated as keys (practice.js): a login may
 * open a record exactly when partyKeysFor(login) includes
 * practiceKeyFor(record's practice). A record with no practice (account_id
 * null: a backfill gap) has no party key, so it fails closed: staff see its
 * label, no client opens it, and no thread can be filed on it. The one
 * exception is a shop order with no practice: it stays its buyer's
 * (`user:<ownerId>`).
 * Message text is sealed and never leaves the module: search matches labels
 * and party names only, and the alert carries ids and labels only.
 */

export const isLabHost = (user) => isStaffRole(user?.role);

const enc = encodeURIComponent;
const SEARCH_ROWS = 200;
const PARTY_PICKER_MAX = 20;
const LABEL_MAX = 200; // the notifier's data guard allows 200 chars a string

// The record's practice key; null (staff only) when it has no practice.
const recordKey = (accountId) => (accountId ? practiceKeyFor({ accountId }) : null);
const mayOpen = (user, partyKey) => isLabHost(user) || (partyKey != null && partyKeysFor(user).includes(partyKey));
const clean = (v) => (v == null ? "" : String(v).trim());

// ── Record resolvers ────────────────────────────────────────────────────────

// The practice key is the record's own practice (account_id, stamped at create),
// as the client scope reads it.
const rxSelect = { id: rxCases.id, caseNumber: rxCases.caseNumber, ownerId: rxCases.userId, accountId: rxCases.accountId };
const orderSelect = { id: labOrders.id, orderNumber: labOrders.orderNumber, ownerId: labOrders.clientUserId, accountId: labOrders.accountId, source: labOrders.source };

const rxQuery = (db, where) => db.select(rxSelect).from(rxCases).where(where);
const orderQuery = (db, where) => db.select(orderSelect).from(labOrders).where(where);
// A pickup carries its practice key (party_key, set at request time), so no owner join.
const pickupQuery = (db, where) => db.select({ id: pickups.id, pickupNumber: pickups.pickupNumber, partyKey: pickups.partyKey }).from(pickups).where(where);

const rxView = (r) => ({
  label: `Case ${r.caseNumber}`, partyKey: recordKey(r.accountId),
  hostPath: `/admin/rx-cases/${enc(r.id)}`, partyPath: `/doctor/cases?case=${enc(r.id)}`,
});
// Doctors don't see lab orders directly, so there is no party path. A guest
// shop order has no owner, so no party: nobody can open a thread on it. A
// buyer's shop order with no practice stays the buyer's (practiceKeyFor's
// user:<ownerId>); any other order with no practice fails closed.
const orderKey = (r) => (r.accountId || r.source !== "shop_order" ? recordKey(r.accountId) : practiceKeyFor({ ownerId: r.ownerId }));
const orderView = (r) => (r.ownerId
  ? { label: `Case #${r.orderNumber}`, partyKey: orderKey(r), hostPath: `/lab/orders/${enc(r.id)}`, partyPath: null }
  : null);

const pickupView = (r) => ({
  label: `Pickup #${r.pickupNumber}`, partyKey: r.partyKey,
  hostPath: `/lab/pickups?pickup=${enc(r.id)}`, partyPath: `/doctor/pickups?pickup=${enc(r.id)}`,
});

/** One record type: a single-row resolve and a batch of labels, both filtered by mayOpen. */
function resolverFor(query, table, view) {
  const visible = (row, user) => {
    const v = row ? view(row) : null;
    return v && mayOpen(user, v.partyKey) ? v : null;
  };
  return {
    async resolve(db, id, user) {
      const [row] = await query(db, eq(table.id, id)).limit(1);
      return visible(row, user);
    },
    async labels(db, ids, user) {
      const rows = ids.length ? await query(db, inArray(table.id, ids)) : [];
      const out = new Map();
      for (const row of rows) {
        const v = visible(row, user);
        if (v) out.set(row.id, v.label);
      }
      return out;
    },
  };
}

/**
 * The lab's record types for messaging (spec "Lab record resolvers"):
 * rx_case "Case {caseNumber}", lab_order "Case #{orderNumber}" and pickup
 * "Pickup #{pickupNumber}" (visible through its party_key).
 */
export const labRecordResolvers = {
  rx_case: resolverFor(rxQuery, rxCases, rxView),
  lab_order: resolverFor(orderQuery, labOrders, orderView),
  pickup: resolverFor(pickupQuery, pickups, pickupView),
};

// ── Labels: parties and authors ─────────────────────────────────────────────

const doctorSelect = { id: users.id, name: users.name, companyName: doctorProfiles.companyName };
const doctorQuery = (db, where) => db.select(doctorSelect).from(users).leftJoin(doctorProfiles, eq(doctorProfiles.userId, users.id)).where(where);
const doctorLabel = (r) => clean(r.companyName) || clean(r.name);

/** Party key → the practice's "name (account number)", or the doctor's companyName / name. Unknown keys are left out. */
export async function describeLabParties(db, keys) {
  const parsed = (keys ?? []).map(parsePartyKey).filter(Boolean);
  const practices = [...new Set(parsed.filter((p) => p.practice != null).map((p) => p.practice))];
  const ids = [...new Set(parsed.filter((p) => p.userId != null).map((p) => p.userId))];
  const [accountRows, doctorRows] = await Promise.all([
    practices.length ? db.select({ id: accounts.id, name: accounts.name, accountNumber: accounts.accountNumber }).from(accounts).where(inArray(accounts.id, practices)) : [],
    ids.length ? doctorQuery(db, inArray(users.id, ids)) : [],
  ]);
  const labels = new Map();
  for (const r of doctorRows) if (doctorLabel(r)) labels.set(practiceKeyFor({ ownerId: r.id }), doctorLabel(r));
  for (const a of accountRows) if (practiceLabel(a)) labels.set(practiceKeyFor({ accountId: a.id }), practiceLabel(a));
  const wanted = new Set(keys);
  return new Map([...labels].filter(([k]) => wanted.has(k)));
}

/** Author id → display name. */
export async function describeLabUsers(db, ids) {
  if (!ids?.length) return new Map();
  const rows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/**
 * Approved, active doctors matching `q` on name or practice name (oldest
 * first): the staff pickup client picker (pickups.service.js).
 */
export function searchApprovedDoctors(db, q = "", limit = SEARCH_ROWS) {
  const conds = [eq(users.role, "doctor"), eq(users.approvalStatus, "approved"), eq(users.status, "active")];
  const text = clean(q);
  if (text) conds.push(or(ilike(users.name, containsPattern(text)), ilike(doctorProfiles.companyName, containsPattern(text))));
  return doctorQuery(db, and(...conds)).orderBy(asc(users.createdAt)).limit(limit);
}

/**
 * Practices (client accounts) matching `q` on their name, account number or an
 * active member's name. `activeOnly` keeps active accounts (the picker: a new
 * thread only goes to a live practice); search reads every practice, since old
 * threads stay findable.
 */
function practiceQuery(db, q, { columns, activeOnly, limit }) {
  const conds = [eq(accounts.isClient, true)];
  if (activeOnly) conds.push(eq(accounts.status, "active"));
  const text = clean(q);
  if (text) {
    const pattern = containsPattern(text);
    const memberIds = db.select({ id: memberships.accountId }).from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.status, "active"), ilike(users.name, pattern)));
    conds.push(or(ilike(accounts.name, pattern), ilike(accounts.accountNumber, pattern), inArray(accounts.id, memberIds)));
  }
  return db.select(columns).from(accounts).where(and(...conds)).orderBy(asc(accounts.name)).limit(limit);
}

/** Staff "New message" picker: active practices by name, number or member, at most 20, as `{ key: "practice:<id>", label }`. */
export async function listLabParties(db, q = "") {
  const rows = await practiceQuery(db, q, {
    columns: { id: accounts.id, name: accounts.name, accountNumber: accounts.accountNumber }, activeOnly: true, limit: PARTY_PICKER_MAX,
  });
  return rows
    .map((a) => ({ key: practiceKeyFor({ accountId: a.id }), label: practiceLabel(a) }))
    .filter((p) => p.label)
    .sort((a, b) => a.label.localeCompare(b.label));
}

// ── Search ──────────────────────────────────────────────────────────────────

/**
 * The messaging `search` collaborator: what a typed query can match. Party
 * names (practice name, account number or member; doctor name or companyName) and record labels (Rx case
 * number, lab order number). Never message text: it is sealed. The service
 * intersects this with the caller's visibility, so it may over-match.
 */
export async function searchLabRecords(db, q) {
  const text = clean(q);
  if (!text) return { partyKeys: [], records: [] };
  const number = text.replace(/^(case|order)\b\s*/i, "").replace(/^#\s*/, "").trim();
  const pattern = containsPattern(text);
  const [practices, doctors, cases, orders] = await Promise.all([
    practiceQuery(db, text, { columns: { id: accounts.id }, activeOnly: false, limit: SEARCH_ROWS }),
    db.select({ id: users.id }).from(users)
      .leftJoin(doctorProfiles, eq(doctorProfiles.userId, users.id))
      .where(and(eq(users.role, "doctor"), or(ilike(users.name, pattern), ilike(doctorProfiles.companyName, pattern))))
      .limit(SEARCH_ROWS),
    number ? db.select({ id: rxCases.id }).from(rxCases).where(ilike(rxCases.caseNumber, containsPattern(number))).limit(SEARCH_ROWS) : [],
    /^\d+$/.test(number)
      ? db.select({ id: labOrders.id }).from(labOrders).where(sql`${labOrders.orderNumber}::text like ${prefixPattern(number)}`).limit(SEARCH_ROWS)
      : [],
  ]);
  return {
    // Matching practices, plus each matching doctor's own key (threads filed before they had a practice).
    partyKeys: [...new Set([...practices.map((a) => practiceKeyFor({ accountId: a.id })), ...doctors.map((d) => practiceKeyFor({ ownerId: d.id }))])],
    records: [
      ...cases.map((r) => ({ recordType: "rx_case", recordId: r.id })),
      ...orders.map((r) => ({ recordType: "lab_order", recordId: r.id })),
    ],
  };
}

// ── Alerts ──────────────────────────────────────────────────────────────────

const clip = (v) => (v == null || v === "" ? null : String(v).slice(0, LABEL_MAX));

/** The event and record a thread's message.received alert collapses on. */
export function messageAlertKey(thread) {
  const hasRecord = Boolean(thread.recordType && thread.recordId);
  return {
    event: "message.received",
    recordType: hasRecord ? thread.recordType : "message_thread",
    recordId: hasRecord ? thread.recordId : thread.id,
  };
}

/**
 * The notify() arguments for one post: the other side of the thread hears
 * about it (host post → the party; party post → staff), never the author.
 * A thread with no record collapses on itself ("message_thread", its id).
 * `data` is ids and labels only.
 */
export function messageAlertArgs({ thread, authorSide, authorUserId, recordLabel }, { senderOrg = null } = {}) {
  return {
    ...messageAlertKey(thread),
    audience: {
      ...(authorSide === "host" ? { party: thread.partyKey } : { kinds: ["staff"] }),
      excludeUserIds: [authorUserId],
    },
    data: { threadId: thread.id, recordLabel: clip(recordLabel), senderOrg: clip(senderOrg) },
  };
}

/**
 * The onMessage hook: emits message.received after the post commits. The
 * sender is the lab's name for a host post, the party's label for a party
 * post. Never throws: a failed label lookup sends without it.
 */
export function createLabMessageAlert({ db, labName, notify = notifySeam, describeParties = describeLabParties, log = console }) {
  return async function labMessageAlert(evt) {
    let senderOrg = null;
    if (evt.authorSide === "host") senderOrg = labName ?? null;
    else {
      try {
        senderOrg = (await describeParties(db, [evt.thread.partyKey])).get(evt.thread.partyKey) ?? null;
      } catch (err) {
        log.warn?.(`[messaging] sender label failed for thread ${evt.thread.id}: ${err?.name ?? "Error"}`);
      }
    }
    try {
      await notify(db, messageAlertArgs(evt, { senderOrg }));
    } catch (err) {
      log.error?.(`[messaging] message.received failed for thread ${evt.thread.id}: ${err?.name ?? "Error"}`);
    }
  };
}

/**
 * The onOpen hook: the reader has seen the thread, so clear their
 * message.received alert for it. The next reply then emails again instead of
 * collapsing into an alert they already acted on. Never throws.
 */
export function createLabThreadOpened({ db, markRead = markReadSeam, log = console }) {
  return async function labThreadOpened({ thread, userId }) {
    try {
      await markRead(db, userId, messageAlertKey(thread));
    } catch (err) {
      log.error?.(`[messaging] clearing the alert failed for thread ${thread.id}: ${err?.name ?? "Error"}`);
    }
  };
}

// ── Attachments ─────────────────────────────────────────────────────────────

/** Message attachments live in record-files under this record type (record id = message id). */
export const MESSAGE_RECORD_TYPE = "message";
export const MESSAGE_FILE_KIND = "attachment";

const attachmentMeta = (f) => ({ id: f.id, fileName: f.originalName, contentType: f.contentType ?? null, sizeBytes: f.size });

/**
 * The messaging `files` collaborator over piece 6's record-files module.
 * `find` answers null for an unknown id and for a file of any other record
 * type, so a download can never sign, say, a lab order's scan.
 */
export function createLabMessageFiles({ service = recordFiles } = {}) {
  return {
    async attach(db, { recordId, files, byUserId }) {
      const rows = await service.attachFiles({
        recordType: MESSAGE_RECORD_TYPE, recordId, byUserId,
        files: files.map((f) => ({ ...f, kind: MESSAGE_FILE_KIND })),
      }, db);
      return rows.map(attachmentMeta);
    },
    async listFor(db, messageIds) {
      const found = await service.filesFor(MESSAGE_RECORD_TYPE, messageIds, db);
      return new Map([...found].map(([id, rows]) => [id, rows.map(attachmentMeta)]));
    },
    async find(db, fileId) {
      try {
        const f = await service.getFile(fileId, db);
        return f.recordType === MESSAGE_RECORD_TYPE ? { id: f.id, messageId: f.recordId } : null;
      } catch (err) {
        if (err?.name === "FileError" && err.code === "NOT_FOUND") return null;
        throw err;
      }
    },
    async signedUrl(db, fileId) {
      return (await service.signedUrlFor(fileId, {}, db)).url;
    },
    async remove(db, fileIds) {
      for (const id of fileIds) await service.removeFile(id, {}, db);
    },
  };
}

/** Routes' onAttachmentRead: audit-log each issued download link (ids only, never the file name). */
export function auditAttachmentRead(request, { fileId, threadId }, log = auditService.logSafe) {
  log({
    userId: request.user.id, action: "message.attachment_url_issued", targetType: "message_thread",
    targetId: threadId, metadata: { fileId }, ipAddress: request.ip,
  });
}

// ── Routes guard and the service ────────────────────────────────────────────

/** Every messaging route: staff pass; anyone else needs the client portal (a practice in scope, or an approved doctor). */
export async function labMessagingGuard(request, reply) {
  if (isLabHost(request.user)) return undefined;
  return requireClientPortal(request, reply);
}

/**
 * The lab's messaging service. `fileService` is record-files (tests pass a
 * stub); `overrides` reach createMessaging as-is (tests pass a fake store).
 */
export function createLabMessaging({
  db, labName, notify = notifySeam, markRead = markReadSeam, log = console, fileService = recordFiles, overrides = {},
}) {
  const messaging = createMessaging({
    db,
    records: labRecordResolvers,
    isHost: isLabHost,
    partyKeysFor,
    // A client's general thread: their one practice, else they must name one (422 "Choose a practice.").
    defaultPartyKey: (user) => newPartyKey(user),
    describeParty: describeLabParties,
    describeUsers: describeLabUsers,
    search: (d, q) => searchLabRecords(d, q),
    onMessage: createLabMessageAlert({ db, labName, notify, log }),
    onOpen: createLabThreadOpened({ db, markRead, log }),
    files: createLabMessageFiles({ service: fileService }),
    log,
    ...overrides,
  });
  return {
    ...messaging,
    // A client's general thread for a named party: never their own `user:` key while they have a practice.
    async createThread(user, input = {}) {
      if (!isLabHost(user) && !input.recordType && typeof input.party === "string") assertNamedPartyKey(user, input.party.trim());
      return messaging.createThread(user, input);
    },
  };
}
