import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createPgClient } from "../config/pg-client.js";

/**
 * Apply a folder of drizzle migrations to `url`, then close the connection.
 * Throws on failure. Never imports config/env.js: the migrate Cloud Run Job and
 * the import DB's migrate script need only a URL. Used by db/migrate.js (the app
 * DB) and import/db/migrate.js (diamond_labs_import, its own folder).
 */
export async function runMigrations({ url, migrationsFolder, label = "migrate" }) {
  const client = createPgClient(url, { max: 1 });
  try {
    console.log(`[${label}] applying migrations from ${migrationsFolder}`);
    await migrate(drizzle(client), { migrationsFolder });
    console.log(`[${label}] done — schema is up to date`);
  } finally {
    await client.end({ timeout: 5 }).catch(() => {});
  }
}
