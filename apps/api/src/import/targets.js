import { drizzle } from "drizzle-orm/postgres-js";
import { createPgClient } from "../config/pg-client.js";
import { ImportRefusal } from "./import-errors.js";

/**
 * Where the piece-5 tools read and write. Each database is named by its own env
 * var and checked by NAME, so a URL pasted into the wrong variable is refused.
 * DATABASE_URL (whatever .env points at) is never a target. Production also
 * needs `--confirm-production diamond_labs` on the command line.
 *
 * Import code reads connection strings from the `env` passed in (default
 * process.env) and must not import config/env.js or config/database.js.
 */
export const IMPORT_DB_NAME = "diamond_labs_import";
export const TARGETS = {
  rehearsal: { envVar: "REHEARSAL_DATABASE_URL", database: "diamond_labs_rehearsal" },
  production: { envVar: "PRODUCTION_DATABASE_URL", database: "diamond_labs" },
};

export function databaseName(url) {
  const m = /^postgres(?:ql)?:\/\/[^/]*\/([^?]+)/.exec(String(url ?? ""));
  return m ? decodeURIComponent(m[1]) : null;
}

export function assertNotCloudRun(env = process.env) {
  if (env.K_SERVICE || env.CLOUD_RUN_JOB) {
    throw new ImportRefusal("Import commands never run on Cloud Run: a Seazona burst from production would block the live portal. Run them from the operator's machine (docs/import-operations.md).");
  }
}

function checked(envVar, expected, env) {
  const url = env[envVar];
  if (!url) throw new ImportRefusal(`${envVar} is not set.`);
  const database = databaseName(url);
  if (database !== expected) throw new ImportRefusal(`${envVar} must point at the ${expected} database (it points at ${database ?? "an unreadable URL"}).`);
  return { url, database };
}

export function resolveImportDb(env = process.env) {
  return { name: "import", ...checked("IMPORT_DATABASE_URL", IMPORT_DB_NAME, env) };
}

export function resolveTarget(name, env = process.env, { confirmProduction } = {}) {
  const t = TARGETS[name];
  if (!t) throw new ImportRefusal("--target must be rehearsal or production.");
  const resolved = { name, ...checked(t.envVar, t.database, env) };
  if (name === "production" && confirmProduction !== t.database) {
    throw new ImportRefusal(`A production load needs --confirm-production ${t.database}.`);
  }
  return resolved;
}

/** Open a resolved database with a drizzle schema. Call close() when done. */
export function connect(resolved, schema) {
  const client = createPgClient(resolved.url, { max: 4, connect_timeout: 15 });
  return { name: resolved.name, database: resolved.database, client, db: drizzle(client, { schema }), close: () => client.end({ timeout: 5 }) };
}
