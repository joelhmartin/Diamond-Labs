// Scrub a staging copy of the production DB: removes all PHI and customer PII.
// Plan (what happens to every column): ./scrub/plan.js, rationale: ./scrub/COLUMNS.md.
//
// Refuses to run unless APP_ENV=staging AND current_database() is exactly
// 'diamond_labs_staging'. One transaction (all or nothing), idempotent, never
// decrypts anything, never touches GCS. Exits non-zero on any error. If the
// transaction fails it empties every PHI/PII-bearing table (fail closed).
//
// Deliberately NOT run with --env-file: the guard must see the real process
// environment (Cloud Run Job), not whatever a local .env happens to hold.
import postgres from "postgres";
import { SCRUB_PLAN, buildStatements, buildEmptyStatement, classSummary, assertScrubAllowed, findUnclassifiedLive } from "./scrub/plan.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[scrub] DATABASE_URL is not set");
  process.exit(1);
}

// Same Cloud SQL unix-socket handling as migrate.js / config/database.js.
const socketMatch = url.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@\/([^?]+)\?host=(.+)$/);
const client = socketMatch
  ? postgres({
      host: decodeURIComponent(socketMatch[4]),
      database: socketMatch[3],
      username: decodeURIComponent(socketMatch[1]),
      password: decodeURIComponent(socketMatch[2]),
      max: 1,
      onnotice: () => {},
    })
  : postgres(url, { max: 1, onnotice: () => {} });

// Guard FIRST, on its own: if this refuses we may be pointed at the wrong database
// (even production), so nothing below, including the fail-closed emptying, may run.
let dbName;
try {
  [{ db: dbName }] = await client`SELECT current_database() AS db`;
  assertScrubAllowed({ appEnv: process.env.APP_ENV, currentDatabase: dbName });
} catch (err) {
  console.error("[scrub] REFUSED:", err.message);
  await client.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
}

try {
  const report = await client.begin(async (tx) => {
    // Drift check against the REAL database catalog (all non-system schemas): a
    // table/column the schema files do not know about must not slip through unscrubbed.
    const rows = await tx`
      SELECT n.nspname AS schema, c.relname AS table_name, a.attname AS column_name
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p')
        AND a.attnum > 0 AND NOT a.attisdropped
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname NOT LIKE 'pg\\_toast%' AND n.nspname NOT LIKE 'pg\\_temp%'`;
    const live = {};
    for (const r of rows) {
      const key = r.schema === "public" ? r.table_name : `${r.schema}.${r.table_name}`;
      (live[key] ||= []).push(r.column_name);
    }
    const drift = findUnclassifiedLive(live);
    if (drift.length) throw new Error(`database has unclassified objects:\n  ${drift.join("\n  ")}`);

    const counts = [];
    for (const s of buildStatements()) {
      const res = await tx.unsafe(s.sql);
      counts.push({ table: s.table, action: s.mode === "delete" ? "deleted" : "updated", rows: res.count });
    }
    return counts;
  });

  console.log(`[scrub] database ${dbName}: committed`);
  for (const c of report) console.log(`[scrub] ${c.table.padEnd(32)} ${c.action.padEnd(8)} ${c.rows}`);

  // Updated/deleted rows leave the old PHI-bearing tuples in dead pages (and in
  // any later export of the files). VACUUM cannot run in a transaction.
  for (const c of report) await client.unsafe(`VACUUM FULL "${c.table}"`);
  console.log(`[scrub] VACUUM FULL ran on ${report.length} tables`);
  console.log(`[scrub] tables in plan: ${Object.keys(SCRUB_PLAN).length}; column classes: ${JSON.stringify(classSummary())}`);
  await client.end({ timeout: 5 });
} catch (err) {
  console.error("[scrub] FAILED (transaction rolled back):", err.message);
  // Fail closed: a rolled-back scrub leaves the whole unscrubbed prod copy in place.
  // The guard already passed (this IS diamond_labs_staging), so empty every table that
  // holds PHI/PII/secrets. Tables list is derived from plan.js.
  try {
    await client.begin((tx) => tx.unsafe(buildEmptyStatement()));
    console.error("[scrub] staging DB emptied — re-import");
  } catch (emptyErr) {
    console.error("[scrub] CRITICAL: could not empty the staging DB; DROP/re-create it now:", emptyErr.message);
  }
  await client.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
}
