/**
 * Small building blocks every lab report file shares: role lists, column
 * specs, row totals and the two client joins. Lab metrics (the numbers
 * themselves) live in lab-metrics.js; this file only shapes definitions.
 */
import { sql } from "drizzle-orm";
import { users, doctorProfiles } from "../../../db/schema/index.js";
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
