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
//
// ANY exit before the scrub completes (module-load failure, bad config, connection
// failure) prints NOT_SCRUBBED: the database must not be served until this exits 0.
const NOT_SCRUBBED = "[scrub] staging DB NOT scrubbed — do not serve it; drop or re-run";
const die = (msg, code = 2) => { console.error(`[scrub] ${msg}`); console.error(NOT_SCRUBBED); process.exit(code); };

let postgres, runScrub, knownMapKeys;
try {
  ({ default: postgres } = await import("postgres"));
  ({ runScrub } = await import("./scrub/run.js"));
  ({ knownMapKeys } = await import("./scrub/known-map-keys.js"));
} catch (err) {
  die(`could not load the scrub: ${String(err?.message ?? err)}`);
}

const url = process.env.DATABASE_URL;
if (!url) die("DATABASE_URL is not set", 1);

// Same Cloud SQL unix-socket handling as migrate.js / config/database.js.
const socketMatch = url.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@\/([^?]+)\?host=(.+)$/);
let client;
try {
  client = socketMatch
  ? postgres({
      host: decodeURIComponent(socketMatch[4]),
      database: socketMatch[3],
      username: decodeURIComponent(socketMatch[1]),
      password: decodeURIComponent(socketMatch[2]),
      max: 1,
      onnotice: () => {},
    })
  : postgres(url, { max: 1, onnotice: () => {} });
} catch (err) {
  die(`could not create the database client: ${String(err?.message ?? err)}`);
}

let exitCode = 2;
try {
  ({ exitCode } = await runScrub(client, process.env, { knownMapKeys: knownMapKeys() }));
} catch (err) {
  console.error("[scrub] CRITICAL: unexpected error:", String(err?.message ?? err));
  console.error(NOT_SCRUBBED);
}
await client.end({ timeout: 5 }).catch(() => {});
process.exit(exitCode);
