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
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    throw new ImportRefusal("The database URL has an unreadable (badly percent-encoded) database name.");
  }
}

// postgres-js lets ?database= override the path, so a URL naming one database
// could connect to another. Only these query keys are allowed.
const ALLOWED_QUERY_KEYS = new Set(["sslmode", "host"]);

function assertSafeQuery(envVar, url) {
  const q = url.indexOf("?");
  if (q === -1) return;
  const socketForm = /^postgres(?:ql)?:\/\/[^/]*@\//.test(url);
  for (const pair of url.slice(q + 1).split("&")) {
    if (!pair) continue;
    let key;
    try {
      key = decodeURIComponent(pair.split("=")[0]).toLowerCase();
    } catch {
      throw new ImportRefusal(`${envVar} has an unreadable query string.`);
    }
    if (!ALLOWED_QUERY_KEYS.has(key) || (key === "host" && !socketForm)) {
      throw new ImportRefusal(`${envVar} may only use the sslmode query option (and host for a Cloud SQL socket URL); a query option can override the database name.`);
    }
  }
}

const safeName = (n) => (n && /^[A-Za-z0-9_-]+$/.test(n) ? n : "an unexpected name");

export function assertNotCloudRun(env = process.env) {
  if (env.K_SERVICE || env.CLOUD_RUN_JOB) {
    throw new ImportRefusal("Import commands never run on Cloud Run: a Seazona burst from production would block the live portal. Run them from the operator's machine (docs/import-operations.md).");
  }
}

function checked(envVar, expected, env) {
  const url = env[envVar];
  if (!url) throw new ImportRefusal(`${envVar} is not set.`);
  const database = databaseName(url);
  if (database !== expected) throw new ImportRefusal(`${envVar} must point at the ${expected} database (it points at ${database === null ? "an unreadable URL" : safeName(database)}).`);
  assertSafeQuery(envVar, url);
  return { url, database };
}

export function resolveImportDb(env = process.env) {
  assertNotCloudRun(env);
  return { name: "import", ...checked("IMPORT_DATABASE_URL", IMPORT_DB_NAME, env) };
}

export function resolveTarget(name, env = process.env, { confirmProduction } = {}) {
  assertNotCloudRun(env);
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
