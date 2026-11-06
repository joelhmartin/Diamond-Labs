import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { isStaffRole, isoDateIn, LAB_TIMEZONE, formatUsDate } from "@my-app/shared";
import { db } from "../../config/database.js";
import { pickups, users, doctorProfiles } from "../../db/schema/index.js";
import { createId } from "../../lib/id.js";
import { fieldSealer } from "../../lib/crypto.js";
import { pageOf, containsPattern, prefixPattern } from "../../lib/list-query.js";
import { allocateSequenceNumber } from "../sequence.service.js";
import { loadClient } from "../billing/statements.service.js";
import { notify } from "../notify-seam.js";
import { clientScopeOf, isAllAccounts, requestedAccounts } from "../client-scope.js";
import { newPartyKey, partyKeysFor, practiceKeyFor } from "../practice.js";
import { practiceForNewRecord } from "../practice-of.js";
import { searchApprovedDoctors } from "./lab-messaging.js";
import { isAssignableStaff } from "./lab-orders.service.js";
import { shipToFromClient } from "./lab-shipping-rules.js";
import { PickupError, planRequest, planSchedule, planComplete, planCancel } from "./pickup-rules.js";

/**
 * Pickups (spec "Pickups (glue)"): a practice asks for a pickup, staff
 * schedule, complete or cancel it, and the other side hears about it. The
 * rules are pickup-rules.js; this file runs them in a transaction and emits
 * after commit through the notify seam, with ids and numbers only.
 *
 * Visibility is the client scope as party keys (services/practice.js):
 * a client (practice staff, a group admin, a doctor) sees and cancels the
 * pickups whose party_key is one of partyKeysFor(login); anything else is
 * NOT_FOUND, never forbidden. Staff see every pickup. A new pickup is keyed
 * to ONE practice: the client's chosen or only one (newPartyKey), or for
 * staff entry the client's chosen or only direct practice (practiceForNewRecord). `database` and `now` are injectable for the DB-free tests.
 */

// Serialises pickup-number allocation (services/sequence.service.js); spec ruling.
export const PICKUP_NUMBER_LOCK = 7300480;
const LIST_CAP = 500;
const OPEN_STATUSES = ["requested", "scheduled"];

const sealer = fieldSealer(["notes", "cancelReason"]);
const client = alias(users, "client");
const assignee = alias(users, "assignee");

const notFound = () => new PickupError("NOT_FOUND", "Pickup not found.");
const isStaff = (user) => isStaffRole(user?.role);
const mayAct = (user, row) => isStaff(user) || partyKeysFor(user).includes(row.partyKey);

export function allocatePickupNumber(tx) {
  return allocateSequenceNumber(tx, { lockId: PICKUP_NUMBER_LOCK, table: pickups, column: pickups.pickupNumber, start: 1 });
}

// Fields a doctor doesn't need: which staff member drives or closed it.
const STAFF_FIELDS = ["assigneeUserId", "completedByUserId", "assigneeName"];

/** A stored row → what the caller sees: sealed text opened, staff fields dropped for a doctor. */
function present(row, user) {
  const out = sealer.open(row);
  if (!isStaff(user)) for (const f of STAFF_FIELDS) delete out[f];
  return out;
}

const ref = (p) => ({ pickupNumber: p.pickupNumber, pickupId: p.id });

/**
 * Staff entry: the client's practice (their direct membership; PRACTICE_REQUIRED 422 when they
 * have several and none was named, NOT_FOUND for one they are not in). A client with no practice
 * yet stays keyed to themself.
 */
async function staffEntryPartyKey(tx, clientUserId, requestedAccountId) {
  const accountId = await practiceForNewRecord(tx, { ownerUserId: clientUserId, requestedAccountId: isAllAccounts(requestedAccountId) ? null : requestedAccountId });
  return practiceKeyFor({ accountId, ownerId: clientUserId });
}

// ── Request ──────────────────────────────────────────────────────────────────

/**
 * A doctor's request for their practice, or staff entering one for a client
 * (`onBehalfOfClientUserId`, source "staff"). The address is the client's
 * profile address at this moment (the Ship form's ship-to shape).
 */
export async function requestPickup(user, input, { onBehalfOfClientUserId = null, database = db, now = new Date() } = {}) {
  const byStaff = isStaff(user);
  const clientUserId = byStaff ? onBehalfOfClientUserId : user?.id;
  if (!clientUserId) throw new PickupError("INVALID", "Pick the client practice.");
  const { accountId: requestedAccountId, ...fields } = input ?? {};
  const values = planRequest(fields, isoDateIn(LAB_TIMEZONE, now));
  // A portal request names its practice before anything is written (422 / 404 refuse it).
  const portalKey = byStaff ? null : newPartyKey(user, requestedAccountId);
  const pickup = await database.transaction(async (tx) => {
    const owner = await loadClient(clientUserId, tx);
    if (!owner) throw new PickupError("NOT_FOUND", "Client not found.");
    const partyKey = portalKey ?? await staffEntryPartyKey(tx, clientUserId, requestedAccountId);
    const row = {
      id: createId(), pickupNumber: await allocatePickupNumber(tx), clientUserId, partyKey,
      requestedByUserId: user.id, ...values, address: shipToFromClient(owner),
      status: "requested", scheduledDate: null, assigneeUserId: null, completedAt: null, completedByUserId: null,
      cancelledAt: null, cancelReason: null, source: byStaff ? "staff" : "portal", version: 1, createdAt: now, updatedAt: now,
    };
    await tx.insert(pickups).values(sealer.seal(row));
    return row;
  });
  await notify(database, {
    event: "lab.pickup_requested", recordType: "pickup", recordId: pickup.id,
    audience: { kinds: ["staff"], excludeUserIds: [user.id] }, data: ref(pickup),
  });
  return present(pickup, user);
}

// ── Moves ───────────────────────────────────────────────────────────────────

/**
 * Load → visibility → plan → UPDATE conditional on the version read, in one
 * transaction. A lost race finds no row to update: STALE.
 */
async function mutate(id, user, plan, database) {
  const updated = await database.transaction(async (tx) => {
    const [row] = await tx.select().from(pickups).where(eq(pickups.id, id));
    if (!row || !mayAct(user, row)) throw notFound();
    const patch = await plan(sealer.open(row), tx);
    const [out] = await tx
      .update(pickups)
      .set(sealer.seal(patch))
      .where(and(eq(pickups.id, id), eq(pickups.version, row.version)))
      .returning();
    if (!out) throw new PickupError("STALE", "This pickup changed — reload.");
    return out;
  });
  return present(updated, user);
}

/** Staff: schedule or reschedule, optionally assigning a driver. Tells the practice. */
export async function schedulePickup(id, { scheduledDate, assigneeUserId, expectedVersion }, user, { database = db, now = new Date() } = {}) {
  if (!isStaff(user)) throw notFound();
  const out = await mutate(id, user, async (pickup, tx) => {
    const patch = planSchedule(pickup, { scheduledDate, assigneeUserId, expectedVersion }, now);
    if (assigneeUserId && !(await isAssignableStaff(tx, assigneeUserId))) {
      throw new PickupError("INVALID", "Pickups can only be assigned to lab staff.");
    }
    return patch;
  }, database);
  await notify(database, {
    event: "lab.pickup_scheduled", recordType: "pickup", recordId: out.id,
    audience: { party: out.partyKey }, data: { ...ref(out), date: formatUsDate(out.scheduledDate) },
  });
  return out;
}

/** Staff: the boxes are collected. No alert. */
export function completePickup(id, { expectedVersion }, user, { database = db, now = new Date() } = {}) {
  if (!isStaff(user)) return Promise.reject(notFound());
  return mutate(id, user, (pickup) => planComplete(pickup, { byUserId: user.id, expectedVersion }, now), database);
}

/** Staff (with a reason) or a doctor of the practice. The other side is told. */
export async function cancelPickup(id, { reason, expectedVersion } = {}, user, { database = db, now = new Date() } = {}) {
  const byStaff = isStaff(user);
  const out = await mutate(id, user, (pickup) => planCancel(pickup, { reason, byStaff, expectedVersion }, now), database);
  await notify(database, {
    event: "lab.pickup_cancelled", recordType: "pickup", recordId: out.id,
    audience: byStaff ? { party: out.partyKey, excludeUserIds: [user.id] } : { kinds: ["staff"], excludeUserIds: [user.id] },
    data: ref(out),
  });
  return out;
}

// ── Reads ───────────────────────────────────────────────────────────────────

const PICKUP_COLS = {
  id: pickups.id, pickupNumber: pickups.pickupNumber, clientUserId: pickups.clientUserId, partyKey: pickups.partyKey,
  requestedByUserId: pickups.requestedByUserId, earliestDate: pickups.earliestDate, latestDate: pickups.latestDate,
  timePreference: pickups.timePreference, boxCount: pickups.boxCount, notes: pickups.notes, address: pickups.address,
  status: pickups.status, scheduledDate: pickups.scheduledDate, assigneeUserId: pickups.assigneeUserId,
  completedAt: pickups.completedAt, completedByUserId: pickups.completedByUserId, cancelledAt: pickups.cancelledAt,
  cancelReason: pickups.cancelReason, source: pickups.source, version: pickups.version,
  createdAt: pickups.createdAt, updatedAt: pickups.updatedAt,
};

/** The lab list's filters: status, a date range over the scheduled (else first) day, driver, number or client text. */
function staffConditions({ id, status, from, to, assigneeUserId, q }) {
  const conds = [];
  if (id) conds.push(eq(pickups.id, id));
  if (status === "open") conds.push(inArray(pickups.status, OPEN_STATUSES));
  else if (status) conds.push(eq(pickups.status, status));
  const day = sql`coalesce(${pickups.scheduledDate}, ${pickups.earliestDate})`;
  if (from) conds.push(gte(day, from));
  if (to) conds.push(lte(day, to));
  if (assigneeUserId) conds.push(eq(pickups.assigneeUserId, assigneeUserId));
  const text = String(q ?? "").trim().replace(/^#\s*/, "");
  if (/^\d+$/.test(text)) conds.push(sql`${pickups.pickupNumber}::text like ${prefixPattern(text)}`);
  else if (text) conds.push(or(ilike(client.name, containsPattern(text)), ilike(doctorProfiles.companyName, containsPattern(text))));
  return conds;
}

/**
 * A client's keys for `?account=`: every key they hold (absent or "all"), or
 * the one practice asked for (out of scope: 404, requestedAccounts).
 */
function clientKeys(user, account) {
  if (isAllAccounts(account)) return partyKeysFor(user);
  return requestedAccounts(clientScopeOf(user), account).map((accountId) => practiceKeyFor({ accountId }));
}

/**
 * `{ rows, total }`, newest first. A client sees the pickups of their party
 * keys (filters: status, account); staff see every pickup with the client's
 * name, practice and driver (filters: status, from, to, assigneeUserId, q).
 * Without `limit`, the first 500.
 */
export async function listPickups(user, filters = {}, { database = db } = {}) {
  const staff = isStaff(user);
  const conds = staff ? staffConditions(filters) : [inArray(pickups.partyKey, clientKeys(user, filters.account))];
  if (!staff && filters.id) conds.push(eq(pickups.id, filters.id));
  if (!staff && filters.status) conds.push(eq(pickups.status, filters.status));
  const where = conds.length ? and(...conds) : undefined;
  const joined = (q) => (staff
    ? q.leftJoin(client, eq(client.id, pickups.clientUserId))
        .leftJoin(doctorProfiles, eq(doctorProfiles.userId, pickups.clientUserId))
        .leftJoin(assignee, eq(assignee.id, pickups.assigneeUserId))
    : q);
  const cols = staff
    ? { ...PICKUP_COLS, clientName: client.name, companyName: doctorProfiles.companyName, assigneeName: assignee.name }
    : PICKUP_COLS;
  const page = pageOf(filters);
  const rows = await joined(database.select(cols).from(pickups))
    .where(where)
    .orderBy(desc(pickups.createdAt), desc(pickups.pickupNumber))
    .limit(page?.limit ?? LIST_CAP)
    .offset(page?.offset ?? 0);
  let total = rows.length;
  if (page) {
    const [c] = await joined(database.select({ total: sql`count(*)::int` }).from(pickups)).where(where);
    total = Number(c?.total ?? 0);
  }
  return { rows: rows.map((r) => present(r, user)), total };
}

/** Scheduled pickups with scheduled_date in [from, to] (the deliveries route sheet joins them to stops). */
export function scheduledPickupsBetween(database, from, to) {
  return database
    .select({
      id: pickups.id, pickupNumber: pickups.pickupNumber, boxCount: pickups.boxCount, clientUserId: pickups.clientUserId,
      partyKey: pickups.partyKey, scheduledDate: pickups.scheduledDate, timePreference: pickups.timePreference,
      assigneeUserId: pickups.assigneeUserId, address: pickups.address, version: pickups.version,
    })
    .from(pickups)
    .where(and(eq(pickups.status, "scheduled"), gte(pickups.scheduledDate, from), lte(pickups.scheduledDate, to)))
    .orderBy(pickups.scheduledDate, pickups.pickupNumber);
}

/**
 * Staff "New pickup" client picker: the approved, active doctors matching `q`
 * (the same search as the message picker) -> [{ id, label }], at most 20.
 */
export async function searchPickupClients(q, { database = db } = {}) {
  const rows = await searchApprovedDoctors(database, q, 20);
  return rows.map((r) => ({ id: r.id, label: r.companyName ? `${r.companyName} (${r.name})` : r.name }));
}

/** One pickup in the caller's list row shape (a doctor only sees their party's), or NOT_FOUND. */
export async function getPickup(id, user, { database = db } = {}) {
  const { rows } = await listPickups(user, { id }, { database });
  if (!rows[0]) throw notFound();
  return rows[0];
}
