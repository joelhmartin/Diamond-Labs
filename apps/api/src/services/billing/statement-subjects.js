import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../config/database.js";
import { users } from "../../db/schema/index.js";
import { organizations, organizationAccounts, organizationAdmins } from "../../modules/organizations/index.js";
import { allPracticeMembersQuery, directPracticeIdsQuery, practiceMembersQuery } from "../practice-of.js";
import { practiceRequired, scopeNotFound } from "../client-scope-rules.js";
import { loadStatementPractices } from "./statements.service.js";

/**
 * Who and what a statement is for (piece 11). A statement's SUBJECT is a
 * practice (`account:<id>`) or a group's combined statement
 * (`organization:<id>`); its RECIPIENT is one login. statement_sends is
 * unique per (subject, recipient, month).
 *
 * Recipients (spec ruling): a practice's statement goes to its ACTIVE,
 * APPROVED DOCTOR members (as before piece 11); the combined statement goes to
 * the group's ACTIVE admins only, never to practice members.
 */

const SUBJECT_KEY = /^(account|organization):.+$/;

/** "account:<id>" | "organization:<id>": statement_sends.subject_key. */
export const subjectKeyOf = (subject, subjectId) => `${subject}:${subjectId}`;

/** A statement_sends write must name its subject; '' is only a legacy row the practice backfill has not mapped yet. */
export function assertSubjectKey(subjectKey) {
  if (typeof subjectKey !== "string" || !SUBJECT_KEY.test(subjectKey)) throw new Error(`statement_sends: bad subject key ${JSON.stringify(subjectKey)}`);
  return subjectKey;
}

/** May this practice member receive the practice's statement? An active, approved doctor. Pure. */
export const isPracticeStatementRecipient = (person) => person?.role === "doctor" && person?.approvalStatus === "approved" && person?.status === "active";

const PERSON = { id: users.id, name: users.name, email: users.email, role: users.role, approvalStatus: users.approvalStatus, status: users.status };

async function loadPeople(userIds, database) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await database.select(PERSON).from(users).where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Everything the monthly run plans from, in six queries whatever the size:
 *   accounts:      active practices with their statement header [{ id, name, accountNumber, address… }] (loadStatementPractices)
 *   members:       active direct members [{ accountId, userId, name, email, role, approvalStatus, status }]
 *   organizations: active groups [{ id, name, settings, accountIds, admins: [{ userId, name, email, status }] }]
 * buildStatementCandidates applies the recipient rules and the combinedStatement setting.
 */
export async function loadStatementSubjects(database = db) {
  const practices = await loadStatementPractices(database);
  const memberRows = await allPracticeMembersQuery(database);
  const groups = await database
    .select({ id: organizations.id, name: organizations.name, settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.status, "active"));
  const groupIds = groups.map((g) => g.id);
  const links = groupIds.length
    ? await database.select({ organizationId: organizationAccounts.organizationId, accountId: organizationAccounts.accountId })
      .from(organizationAccounts).where(inArray(organizationAccounts.organizationId, groupIds))
    : [];
  const grants = groupIds.length
    ? await database.select({ organizationId: organizationAdmins.organizationId, userId: organizationAdmins.userId })
      .from(organizationAdmins).where(and(inArray(organizationAdmins.organizationId, groupIds), eq(organizationAdmins.status, "active")))
    : [];
  const people = await loadPeople([...memberRows.map((m) => m.userId), ...grants.map((g) => g.userId)], database);
  const person = (userId) => people.get(userId);
  return {
    accounts: practices,
    members: memberRows.filter((m) => person(m.userId)).map((m) => ({ accountId: m.accountId, userId: m.userId, ...without(person(m.userId), "id") })),
    organizations: groups.map((g) => ({
      id: g.id, name: g.name, settings: g.settings ?? {},
      accountIds: links.filter((l) => l.organizationId === g.id).map((l) => l.accountId),
      admins: grants.filter((a) => a.organizationId === g.id && person(a.userId)).map((a) => ({ userId: a.userId, ...without(person(a.userId), "id") })),
    })),
  };
}

function without(obj, key) {
  const { [key]: _drop, ...rest } = obj;
  return rest;
}

/** The people a practice's statement goes to now (the single "Email statement" action): its active, approved doctor members. */
export async function practiceStatementRecipients(accountId, database = db) {
  const rows = await practiceMembersQuery(database, accountId);
  const people = await loadPeople(rows.map((r) => r.userId), database);
  return [...people.values()].filter(isPracticeStatementRecipient);
}

/**
 * These logins as recipients of a practice statement (an admin naming a
 * person), in the order given. The same rule as the run: only active,
 * approved doctors; anyone else (and an unknown id) is left out.
 */
export async function statementRecipients(userIds, database = db) {
  const people = await loadPeople(userIds, database);
  return userIds.map((id) => people.get(id)).filter(isPracticeStatementRecipient);
}

/**
 * The one practice a client login works in directly, for the admin's
 * per-client statement routes (thin wrappers onto the practice's): none →
 * 404 NOT_FOUND; more than one → 422 PRACTICE_REQUIRED (use the practice's
 * own statement instead).
 */
export async function singlePracticeOf(userId, database = db) {
  const rows = await directPracticeIdsQuery(database, userId);
  const ids = [...new Set(rows.map((r) => r.accountId))];
  if (ids.length === 1) return ids[0];
  if (!ids.length) throw scopeNotFound();
  throw practiceRequired("This client is in more than one practice. Use the practice's statement.");
}
