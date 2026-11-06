/**
 * Small building blocks every lab report file shares: role lists, column
 * specs, row totals, the two client joins and the practice/group filter. Lab metrics (the numbers
 * themselves) live in lab-metrics.js; this file only shapes definitions.
 */
import { sql } from "drizzle-orm";
import { users, doctorProfiles, accounts, organizationAccounts } from "../../../db/schema/index.js";
import { isClient } from "./lab-metrics.js";

/** Reports, metrics and dashboards only admins may see (anything showing money). */
export const ADMIN = Object.freeze(["admin"]);

/** The label for a catalog line or order whose product family has no category. */
export const UNCATEGORIZED = "Uncategorized";
/** The same as a SQL literal (not a bound parameter, so a select and its GROUP BY stay one expression). */
export const uncategorizedSql = sql.raw(`'${UNCATEGORIZED}'`);

// ── Column specs ─────────────────────────────────────────────────────────

export const int = (id, label, extra = {}) => ({ id, label, type: "int", ...extra });
export const money = (id, label, extra = {}) => ({ id, label, type: "money", ...extra });

// ── Row totals ───────────────────────────────────────────────────────────

/** The sum of one numeric field over rows (null/undefined count as 0). */
export const sumOf = (rows, key) => rows.reduce((s, r) => s + (r[key] ?? 0), 0);

/** `{ [key]: sumOf(rows, key) }` for each key: a summary row's totals. */
export const sums = (rows, keys) => Object.fromEntries(keys.map((k) => [k, sumOf(rows, k)]));

/** part / whole, 0 when whole is 0 (a `pct` column's value). */
export const share = (part, whole) => (whole ? part / whole : 0);

// ── Client joins (users + doctor_profiles, so `clientName` resolves) ─────

/**
 * Left joins the user a row belongs to, whoever it is: rows with no client
 * (or a non-client user) are kept, their client columns null.
 */
export const optionalClientJoin = (clientUserIdExpr) =>
  sql`left join ${users} on ${users.id} = ${clientUserIdExpr} left join ${doctorProfiles} on ${doctorProfiles.userId} = ${users.id}`;

/** Inner joins the client user (isClient): rows that do not belong to a client are dropped. */
export const clientsOnlyJoin = (clientUserIdExpr) =>
  sql`join ${users} on ${users.id} = ${clientUserIdExpr} and ${isClient} left join ${doctorProfiles} on ${doctorProfiles.userId} = ${users.id}`;

// ── Practice / group filter (piece 11 practices) ─────────────────────────

/**
 * The two optional filters every client-bearing report takes: one practice (a
 * client account) and one group (an organization, meaning its member
 * practices). Both are the generic `lookup` param type (lookups.js `practice`
 * and `organization`); set together, a row must match both.
 */
export const PRACTICE_PARAMS = Object.freeze([
  Object.freeze({ name: "practice", label: "Practice", type: "lookup", source: "practice" }),
  Object.freeze({ name: "organization", label: "Group", type: "lookup", source: "organization" }),
]);

/** True when a practice or group filter is set in the report's params. */
export const hasPracticeFilter = (params) => Boolean(params?.practice || params?.organization);

/**
 * THE practice/group condition on a record's account id column (or SQL
 * expression): `= practice`, and/or in the group's member accounts
 * (organization_accounts). No filter is `true`. An unknown id matches nothing
 * (an empty result, never an error); a record with no account never matches a
 * set filter.
 */
export function practiceFilterSql(params, accountIdColumn) {
  const parts = [];
  if (params?.practice) parts.push(sql`${accountIdColumn} = ${params.practice}`);
  if (params?.organization) {
    parts.push(sql`${accountIdColumn} in (select ${organizationAccounts.accountId} from ${organizationAccounts} where ${organizationAccounts.organizationId} = ${params.organization})`);
  }
  return parts.length ? sql.join(parts, sql` and `) : sql`true`;
}

/**
 * The same filter as a function of the column, for the shared metrics
 * (lab-metrics.js, order-metrics.js, client-health.js), which apply it to
 * whichever table they read: `scope(invoices.accountId)`. Null when no filter
 * is set, so an unfiltered run's SQL is unchanged.
 */
export const practiceScope = (params) => (hasPracticeFilter(params) ? (col) => practiceFilterSql(params, col) : null);

/** ` and <filter on accountIdColumn>` when a practice or group is set, else nothing (the unfiltered SQL is unchanged). */
export const andPractice = (params, accountIdColumn) => (hasPracticeFilter(params) ? sql` and ${practiceFilterSql(params, accountIdColumn)}` : sql``);

/**
 * The client account ids the filter selects (any status), or null when no
 * filter is set: for a service that takes an account id list (statements) or
 * returns rows keyed by account (receivables). An unknown id gives [].
 */
export async function practiceAccountIds(tx, params) {
  if (!hasPracticeFilter(params)) return null;
  const rows = await tx.select({ id: accounts.id }).from(accounts)
    .where(sql`${accounts.isClient} and ${practiceFilterSql(params, accounts.id)}`);
  return rows.map((r) => r.id);
}
