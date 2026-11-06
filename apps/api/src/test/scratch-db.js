/**
 * A throwaway Postgres database for an opt-in real-database test. The test
 * names a LOCAL server through an env var; this creates a uniquely named
 * database on it, migrates it, hands back a drizzle handle, and drops it with
 * force afterwards. It never writes to a database it did not create:
 * `current_database()` is asserted before the handle is returned.
 *
 *   const scratch = createScratchDb({ prefix: "my_test", label: "my-test" });
 *   afterAll(scratch.drop);
 *   test.skipIf(!scratch.enabled)("...", async () => { const { db, client } = await scratch.open(); ... });
 *
 * The server URL comes from SCRATCH_DB_SERVER_URL (e.g.
 * postgresql://bif@localhost:5432/postgres); a test may also accept an older
 * env name through `envNames`.
 */
import { fileURLToPath } from "node:url";

const MIGRATIONS = fileURLToPath(new URL("../db/migrations", import.meta.url));
const DEFAULT_ENV = ["SCRATCH_DB_SERVER_URL"];

export function createScratchDb({ prefix, label = prefix, envNames = [], migrate = true } = {}) {
  if (!/^[a-z][a-z0-9_]*$/.test(prefix)) throw new Error("scratch prefix must be lowercase letters, digits, underscore");
  const server = [...DEFAULT_ENV, ...envNames].map((n) => process.env[n]).find(Boolean);
  const name = `${prefix}_${process.pid}_${Date.now()}`;
  let created = false;
  let client = null;

  const withDatabase = (url, db) => { const u = new URL(url); u.pathname = `/${db}`; return u.toString(); };

  async function adminSql(statement) {
    const { default: postgres } = await import("postgres");
    const admin = postgres(server, { max: 1, onnotice: () => {} });
    try { await admin.unsafe(statement); } finally { await admin.end(); }
  }

  return {
    enabled: Boolean(server),
    name,
    /** Creates, (optionally) migrates and opens the database: { db, client, url }. */
    async open() {
      if (!/^(localhost|127\.0\.0\.1)$/.test(new URL(server).hostname)) throw new Error("only a local server");
      await adminSql(`create database "${name}"`);
      created = true;
      const url = withDatabase(server, name);
      if (migrate) {
        const { runMigrations } = await import("../db/run-migrations.js");
        await runMigrations({ url, migrationsFolder: MIGRATIONS, label });
      }
      const { default: postgres } = await import("postgres");
      const { drizzle } = await import("drizzle-orm/postgres-js");
      client = postgres(url, { max: 1, onnotice: () => {} });
      const [{ current }] = await client`select current_database() as current`;
      if (current !== name) throw new Error(`connected to ${current}, not the scratch database ${name}`);
      return { db: drizzle(client), client, url };
    },
    /** Closes the handle and drops the database (safe to call when nothing was created). */
    async drop() {
      if (client) { await client.end().catch(() => {}); client = null; }
      if (created) { await adminSql(`drop database if exists "${name}" with (force)`); created = false; }
    },
  };
}
