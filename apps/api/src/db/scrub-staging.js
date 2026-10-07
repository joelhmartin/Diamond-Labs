// Scrub a staging copy of the production DB: removes all PHI and customer PII.
// Plan (what happens to every column): ./scrub/plan.js, rationale: ./scrub/COLUMNS.md.
//
// Refuses to run unless APP_ENV=staging AND current_database() is exactly
// 'diamond_labs_staging'. One transaction (all or nothing), idempotent, never
// decrypts anything, never touches GCS. Exits non-zero on any error.
//
// Deliberately NOT run with --env-file: the guard must see the real process
// environment (Cloud Run Job), not whatever a local .env happens to hold.
import postgres from "postgres";
import { SCRUB_PLAN, buildStatements, classSummary, assertScrubAllowed, findUnclassifiedLive } from "./scrub/plan.js";

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
    })
  : postgres(url, { max: 1 });

try {
  const report = await client.begin(async (tx) => {
    const [{ db }] = await tx`SELECT current_database() AS db`;
    assertScrubAllowed({ appEnv: process.env.APP_ENV, currentDatabase: db });

    // Drift check against the REAL database: a table/column the schema files do not
    // know about (e.g. an unmerged migration) must not slip through unscrubbed.
    const rows = await tx`
      SELECT c.table_name, c.column_name
      FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'`;
    const live = {};
    for (const r of rows) (live[r.table_name] ||= []).push(r.column_name);
    const drift = findUnclassifiedLive(live);
    if (drift.length) throw new Error(`database has unclassified objects:\n  ${drift.join("\n  ")}`);

    const counts = [];
    for (const s of buildStatements()) {
      const res = await tx.unsafe(s.sql);
      counts.push({ table: s.table, action: s.mode === "delete" ? "deleted" : "updated", rows: res.count });
    }
    return { db, counts };
  });

  console.log(`[scrub] database ${report.db}: committed`);
  for (const c of report.counts) console.log(`[scrub] ${c.table.padEnd(32)} ${c.action.padEnd(8)} ${c.rows}`);
  console.log(`[scrub] tables in plan: ${Object.keys(SCRUB_PLAN).length}; column classes: ${JSON.stringify(classSummary())}`);
  await client.end({ timeout: 5 });
} catch (err) {
  console.error("[scrub] FAILED (transaction rolled back):", err.message);
  await client.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
}
