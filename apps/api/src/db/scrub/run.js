// Control flow of the staging scrub, with the database client INJECTED so every
// branch is unit-testable with a fake. The client needs only:
//   client.unsafe(sql, params?) -> rows (with .count for DML)
//   client.begin(async (tx) => ...) -> runs fn in a transaction (tx has .unsafe)
//
// Outcomes (returned as exitCode, never process.exit here):
//   0  scrubbed, committed, vacuumed
//   1  refused by the guard (nothing touched), OR the run failed and the database was
//      emptied ("staging DB emptied — re-import")
//   2  the run failed AND the emptying itself failed: drop the database now
//
// FAIL CLOSED: once the guard has passed, ANY failure (schema behind code, drift,
// the scrub transaction, VACUUM) empties every table in every non-system schema,
// discovered from the live catalog, never from the plan, so it works even when the
// plan's tables do not exist.
import { SCRUB_PLAN, buildStatements, classSummary, assertScrubAllowed, findUnclassifiedLive, findMissingFromLive, keyOf } from "./plan.js";
import { MARKER_RELATION } from "../../config/app-env.js";

const SCHEMA_BEHIND = "schema behind code — run diamond-labs-migrate-staging before scrubbing";
export const NOT_SCRUBBED = "[scrub] staging DB NOT scrubbed — do not serve it; drop or re-run";
// The marker is deliberately NOT kept: fail-closed emptying truncates it, so a failed
// scrub leaves no marker and the server refuses to serve the database.
const KEEP_OUT = new Set(["drizzle.__drizzle_migrations"]);
export const SCRUB_VERSION = "staging-scrub-v1";
const MARKER_DDL = `CREATE TABLE IF NOT EXISTS ${MARKER_RELATION} (id int primary key, scrubbed_at timestamptz not null, scrub_version text)`;
const MARKER_UPSERT =
  `INSERT INTO ${MARKER_RELATION} (id, scrubbed_at, scrub_version) VALUES (1, now(), $1) ` +
  "ON CONFLICT (id) DO UPDATE SET scrubbed_at = EXCLUDED.scrubbed_at, scrub_version = EXCLUDED.scrub_version";
const fq = (schema, table) => `"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`;

// relkind r table, p partitioned, m materialized view, f foreign table.
const LIVE_COLUMNS_SQL = `
  SELECT n.nspname AS schema, c.relname AS table_name, a.attname AS column_name
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p', 'm', 'f')
    AND a.attnum > 0 AND NOT a.attisdropped
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname NOT LIKE 'pg\\_toast%' AND n.nspname NOT LIKE 'pg\\_temp%'`;

const LIVE_RELATIONS_SQL = `
  SELECT n.nspname AS schema, c.relname AS table_name, c.relkind AS relkind
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p', 'm', 'f')
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname NOT LIKE 'pg\\_toast%' AND n.nspname NOT LIKE 'pg\\_temp%'`;

async function currentDb(client) {
  const rows = await client.unsafe("SELECT current_database() AS db");
  return rows[0]?.db;
}

async function loadLive(client) {
  const live = {};
  for (const r of await client.unsafe(LIVE_COLUMNS_SQL)) (live[keyOf(r.schema, r.table_name)] ||= []).push(r.column_name);
  return live;
}

/** Empty everything. Returns 1 (emptied) or 2 (could not fully empty / refused). */
async function failClosed(client, env, out, reason) {
  out.error(`[scrub] FAILED: ${reason}`);
  try {
    // Re-check on the same connection immediately before destroying anything.
    assertScrubAllowed({ appEnv: env.APP_ENV, currentDatabase: await currentDb(client) });
  } catch (e) {
    out.error(`[scrub] CRITICAL: not emptying, guard re-check failed: ${e.message}`);
    return 2;
  }

  let rels;
  try {
    rels = (await client.unsafe(LIVE_RELATIONS_SQL)).filter((r) => !KEEP_OUT.has(keyOf(r.schema, r.table_name)));
  } catch (e) {
    out.error(`[scrub] CRITICAL: staging DB NOT fully emptied — drop the database now (could not list tables: ${e.message})`);
    return 2;
  }

  const foreign = rels.filter((r) => r.relkind === "f").map((r) => keyOf(r.schema, r.table_name));
  if (foreign.length) out.error(`[scrub] foreign tables cannot be truncated, skipped: ${foreign.join(", ")}`);

  // A foreign table cannot be truncated, so its (possibly remote/production) rows may persist.
  const failed = [...foreign];
  // Matviews first (dropped: TRUNCATE does not apply, and a refresh would depend on order),
  // then plain/partitioned tables, one statement each so one failure cannot block the rest.
  const order = [...rels.filter((r) => r.relkind === "m"), ...rels.filter((r) => r.relkind === "r" || r.relkind === "p")];
  for (const r of order) {
    const name = keyOf(r.schema, r.table_name);
    const sql = r.relkind === "m" ? `DROP MATERIALIZED VIEW IF EXISTS ${fq(r.schema, r.table_name)} CASCADE` : `TRUNCATE TABLE ${fq(r.schema, r.table_name)} CASCADE`;
    try {
      await client.unsafe(sql);
    } catch (e) {
      failed.push(name);
      out.error(`[scrub] could not empty ${name}: ${e.message}`);
    }
  }
  if (failed.length) {
    out.error(`[scrub] CRITICAL: staging DB NOT fully emptied — drop the database now (${failed.join(", ")})`);
    return 2;
  }
  out.error("[scrub] staging DB emptied — re-import");
  return 1;
}

/**
 * @param client  injected DB client (see header)
 * @param env     process.env-like ({ APP_ENV })
 * @param opts    { plan, knownMapKeys, out: { log, error } }
 * @returns {Promise<{exitCode: number}>}
 */
export async function runScrub(client, env, { plan = SCRUB_PLAN, knownMapKeys, out = console } = {}) {
  // Guard FIRST and alone: a refusal may mean the wrong (even production) database,
  // so nothing below, including the emptying, may run.
  let dbName;
  try {
    dbName = await currentDb(client);
    assertScrubAllowed({ appEnv: env.APP_ENV, currentDatabase: dbName });
  } catch (err) {
    out.error(`[scrub] REFUSED: ${String(err?.message ?? err)}`);
    out.error(NOT_SCRUBBED);
    return { exitCode: 1 };
  }

  let committed = false;
  try {
    // Pre-checks: schema must match the plan exactly, in both directions.
    const live = await loadLive(client);
    const missing = findMissingFromLive(live, plan);
    if (missing.length) throw new Error(`${SCHEMA_BEHIND}\n  ${missing.join("\n  ")}`);
    const drift = findUnclassifiedLive(live, plan);
    if (drift.length) throw new Error(`database has unclassified objects:\n  ${drift.join("\n  ")}`);

    const statements = buildStatements(plan, { knownMapKeys });
    const counts = await client.begin(async (tx) => {
      const acc = [];
      for (const s of statements) {
        const res = await tx.unsafe(s.sql, s.params);
        acc.push({ table: s.table, action: s.mode === "delete" ? "deleted" : "updated", rows: res.count });
      }
      // Same transaction as the scrub: the marker exists only if the scrub committed.
      await tx.unsafe(MARKER_DDL);
      await tx.unsafe(MARKER_UPSERT, [SCRUB_VERSION]);
      return acc;
    });
    committed = true;

    out.log(`[scrub] database ${dbName}: committed`);
    for (const c of counts) out.log(`[scrub] ${c.table.padEnd(32)} ${c.action.padEnd(8)} ${c.rows}`);

    // Old PHI-bearing tuples linger in dead pages (and any later export) until VACUUM FULL,
    // which cannot run inside a transaction.
    const touched = [...new Set(counts.map((c) => c.table))];
    for (const t of touched) await client.unsafe(`VACUUM FULL "${t}"`);
    out.log(`[scrub] VACUUM FULL ran on ${touched.length} tables`);
    out.log(`[scrub] tables in plan: ${Object.keys(plan).length}; column classes: ${JSON.stringify(classSummary(plan))}`);
    return { exitCode: 0 };
  } catch (err) {
    const msg = String(err?.message ?? err); // a non-Error throw must still reach the emptying path
    const reason = committed
      ? `scrub committed; VACUUM failed — emptying as a precaution (${msg})`
      : msg.startsWith(SCHEMA_BEHIND) || msg.startsWith("database has unclassified")
        ? msg
        : `transaction rolled back: ${msg}`;
    const exitCode = await failClosed(client, env, out, reason);
    if (exitCode === 2) out.error(NOT_SCRUBBED);
    return { exitCode };
  }
}
