// Scrub a staging copy of the production DB: removes all PHI and customer PII.
// Plan (what happens to every column): ./scrub/plan.js, rationale: ./scrub/COLUMNS.md,
// control flow (guard, pre-checks, transaction, VACUUM, fail-closed emptying): ./scrub/run.js.
//
// Refuses to run unless APP_ENV=staging AND current_database() is exactly
// 'diamond_labs_staging'. Exit 0 = scrubbed; 1 = refused, or failed and the DB was
// emptied (re-import); 2 = failed and could NOT be emptied (drop the database now).
//
// Deliberately NOT run with --env-file: the guard must see the real process
// environment (Cloud Run Job), not whatever a local .env happens to hold.
import postgres from "postgres";
import { runScrub } from "./scrub/run.js";
import { knownMapKeys } from "./scrub/known-map-keys.js";

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

let exitCode = 2;
try {
  ({ exitCode } = await runScrub(client, process.env, { knownMapKeys: knownMapKeys() }));
} catch (err) {
  console.error("[scrub] CRITICAL: unexpected error:", err.message);
}
await client.end({ timeout: 5 }).catch(() => {});
process.exit(exitCode);
