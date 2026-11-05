import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { isStaffRole } from "@my-app/shared";
import { doctorProfiles, labOrders, pickups, rxCases, users } from "../../db/schema/index.js";
import { containsPattern, prefixPattern } from "../../lib/list-query.js";
import { requireApprovedDoctor } from "../../middleware/require-role.js";
import { createMessaging } from "../../modules/messaging/index.js";
import { notify as notifySeam } from "../notify-seam.js";
import { parsePartyKey, partyKeysFor, practiceKeyFor } from "../practice.js";

/**
 * Lab glue for the generic messaging module: lab staff are the host, a
 * doctor's practice (services/practice.js keys) is the party. This file owns
 * the record resolvers (Rx case, lab order, pickup), the party and author
 * labels, search, the staff "New message" picker, the route guard and the
 * message.received alert. Boot (services/app-modules.js) wires it once.
 *
 * Visibility is canActOnInvoice restated as keys (practice.js): a doctor may
 * open a record exactly when partyKeysFor(doctor) includes
 * practiceKeyFor(record owner). Staff see every record that has an owner.
 * Message text is sealed and never leaves the module: search matches labels
 * and party names only, and the alert carries ids and labels only.
 */

export const isLabHost = (user) => isStaffRole(user?.role);

const enc = encodeURIComponent;
const SEARCH_ROWS = 200;
const PARTY_PICKER_MAX = 20;
const LABEL_MAX = 200; // the notifier's data guard allows 200 chars a string

const ownerKey = (ownerId, ownerClientId) => practiceKeyFor({ id: ownerId, seazonaClientId: ownerClientId ?? null });
const mayOpen = (user, partyKey) => isLabHost(user) || partyKeysFor(user).includes(partyKey);
const clean = (v) => (v == null ? "" : String(v).trim());

// ── Record resolvers ────────────────────────────────────────────────────────

// Owner columns joined in: the practice key is computed from the owner's
// current account, as canActOnInvoice does, never from a copy on the record.
const rxSelect = { id: rxCases.id, caseNumber: rxCases.caseNumber, ownerId: rxCases.userId, ownerClientId: users.seazonaClientId };
const orderSelect = { id: labOrders.id, orderNumber: labOrders.orderNumber, ownerId: labOrders.clientUserId, ownerClientId: users.seazonaClientId };

const rxQuery = (db, where) => db.select(rxSelect).from(rxCases).leftJoin(users, eq(users.id, rxCases.userId)).where(where);
const orderQuery = (db, where) => db.select(orderSelect).from(labOrders).leftJoin(users, eq(users.id, labOrders.clientUserId)).where(where);
// A pickup carries its practice key (party_key, set at request time), so no owner join.
const pickupQuery = (db, where) => db.select({ id: pickups.id, pickupNumber: pickups.pickupNumber, partyKey: pickups.partyKey }).from(pickups).where(where);

const rxView = (r) => ({
  label: `Case ${r.caseNumber}`, partyKey: ownerKey(r.ownerId, r.ownerClientId),
  hostPath: `/admin/rx-cases/${enc(r.id)}`, partyPath: `/doctor/cases?case=${enc(r.id)}`,
});
// Doctors don't see lab orders directly, so there is no party path. A guest
// shop order has no owner, so no party: nobody can open a thread on it.
const orderView = (r) => (r.ownerId
  ? { label: `Case #${r.orderNumber}`, partyKey: ownerKey(r.ownerId, r.ownerClientId), hostPath: `/lab/orders/${enc(r.id)}`, partyPath: null }
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

const doctorSelect = { id: users.id, name: users.name, seazonaClientId: users.seazonaClientId, companyName: doctorProfiles.companyName };
const doctorQuery = (db, where) => db.select(doctorSelect).from(users).leftJoin(doctorProfiles, eq(doctorProfiles.userId, users.id)).where(where);

/**
 * key → label from user rows (oldest first): a practice is named by the first
 * companyName any of its doctors has, else the first doctor's name.
 */
function labelsByKey(rows, keysOf) {
  const best = new Map();
  for (const r of rows) {
    const company = clean(r.companyName);
    const label = company || clean(r.name);
    if (!label) continue;
    for (const key of keysOf(r)) {
      const cur = best.get(key);
      if (!cur || (company && !cur.company)) best.set(key, { label, company: Boolean(company) });
    }
  }
  return new Map([...best].map(([k, v]) => [k, v.label]));
}

/** Party key → the practice's companyName, or the doctor's name. Unknown keys are left out. */
export async function describeLabParties(db, keys) {
  const parsed = (keys ?? []).map(parsePartyKey).filter(Boolean);
  const practices = [...new Set(parsed.filter((p) => p.practice != null).map((p) => p.practice))];
  const ids = [...new Set(parsed.filter((p) => p.userId != null).map((p) => p.userId))];
  if (!practices.length && !ids.length) return new Map();
  const conds = [];
  if (practices.length) conds.push(inArray(users.seazonaClientId, practices));
  if (ids.length) conds.push(inArray(users.id, ids));
  const rows = await doctorQuery(db, or(...conds)).orderBy(asc(users.createdAt));
  const labels = labelsByKey(rows, partyKeysFor);
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
 * first). The one doctor search behind both staff pickers (message parties and
 * the pickup client), so they agree on who is eligible.
 */
export function searchApprovedDoctors(db, q = "", limit = SEARCH_ROWS) {
  const conds = [eq(users.role, "doctor"), eq(users.approvalStatus, "approved"), eq(users.status, "active")];
  const text = clean(q);
  if (text) conds.push(or(ilike(users.name, containsPattern(text)), ilike(doctorProfiles.companyName, containsPattern(text))));
  return doctorQuery(db, and(...conds)).orderBy(asc(users.createdAt)).limit(limit);
}

/** Staff "New message" picker: approved, active doctors grouped by practice key, at most 20. */
export async function listLabParties(db, q = "") {
  const rows = await searchApprovedDoctors(db, q);
  const labels = labelsByKey(rows, (r) => [practiceKeyFor(r)]);
  return [...labels]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label))
    .slice(0, PARTY_PICKER_MAX);
}

// ── Search ──────────────────────────────────────────────────────────────────

/**
 * The messaging `search` collaborator: what a typed query can match. Party
 * names (doctor name or practice companyName) and record labels (Rx case
 * number, lab order number). Never message text: it is sealed. The service
 * intersects this with the caller's visibility, so it may over-match.
 */
export async function searchLabRecords(db, q) {
  const text = clean(q);
  if (!text) return { partyKeys: [], records: [] };
  const number = text.replace(/^(case|order)\b\s*/i, "").replace(/^#\s*/, "").trim();
  const pattern = containsPattern(text);
  const [doctors, cases, orders] = await Promise.all([
    db.select({ id: users.id, seazonaClientId: users.seazonaClientId }).from(users)
      .leftJoin(doctorProfiles, eq(doctorProfiles.userId, users.id))
      .where(and(eq(users.role, "doctor"), or(ilike(users.name, pattern), ilike(doctorProfiles.companyName, pattern))))
      .limit(SEARCH_ROWS),
    number ? db.select({ id: rxCases.id }).from(rxCases).where(ilike(rxCases.caseNumber, containsPattern(number))).limit(SEARCH_ROWS) : [],
    /^\d+$/.test(number)
      ? db.select({ id: labOrders.id }).from(labOrders).where(sql`${labOrders.orderNumber}::text like ${prefixPattern(number)}`).limit(SEARCH_ROWS)
      : [],
  ]);
  return {
    partyKeys: [...new Set(doctors.flatMap(partyKeysFor))],
    records: [
      ...cases.map((r) => ({ recordType: "rx_case", recordId: r.id })),
      ...orders.map((r) => ({ recordType: "lab_order", recordId: r.id })),
    ],
  };
}

// ── Alerts ──────────────────────────────────────────────────────────────────

const clip = (v) => (v == null || v === "" ? null : String(v).slice(0, LABEL_MAX));

/**
 * The notify() arguments for one post: the other side of the thread hears
 * about it (host post → the party; party post → staff), never the author.
 * A thread with no record collapses on itself ("message_thread", its id).
 * `data` is ids and labels only.
 */
export function messageAlertArgs({ thread, authorSide, authorUserId, recordLabel }, { senderOrg = null } = {}) {
  const hasRecord = Boolean(thread.recordType && thread.recordId);
  return {
    event: "message.received",
    recordType: hasRecord ? thread.recordType : "message_thread",
    recordId: hasRecord ? thread.recordId : thread.id,
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

// ── Routes guard and the service ────────────────────────────────────────────

/** Every messaging route: staff pass; anyone else must be an approved doctor. */
export async function labMessagingGuard(request, reply) {
  if (isLabHost(request.user)) return undefined;
  return requireApprovedDoctor(request, reply);
}

/** The lab's messaging service. `overrides` reach createMessaging as-is (tests pass a fake store). */
export function createLabMessaging({ db, labName, notify = notifySeam, log = console, overrides = {} }) {
  return createMessaging({
    db,
    records: labRecordResolvers,
    isHost: isLabHost,
    partyKeysFor,
    defaultPartyKey: practiceKeyFor,
    describeParty: describeLabParties,
    describeUsers: describeLabUsers,
    search: (d, q) => searchLabRecords(d, q),
    onMessage: createLabMessageAlert({ db, labName, notify, log }),
    log,
    ...overrides,
  });
}
