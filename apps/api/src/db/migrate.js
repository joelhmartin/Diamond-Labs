// Runtime migration runner — applies pending Drizzle migrations against the
// configured DATABASE_URL, then exits. Used by the `diamond-labs-migrate`
// Cloud Run Job in the deploy pipeline (and runnable locally).
//
// Why not `drizzle-kit migrate`?
//   1. drizzle-kit is a devDependency and is NOT in the production (--prod)
//      image, whereas drizzle-orm + postgres ARE.
//   2. drizzle-kit hands DATABASE_URL straight to a URL parser that throws on
//      Cloud SQL's unix-socket form (postgresql://u:p@/db?host=/cloudsql/...).
//
// This runner intentionally does NOT import ../config/env.js: the job only
// needs DATABASE_URL, not the full env validation the API service requires.
import { runMigrations } from "./run-migrations.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL is not set");
  process.exit(1);
}

try {
  await runMigrations({ url, migrationsFolder: new URL("./migrations", import.meta.url).pathname });
  process.exit(0);
} catch (err) {
  console.error("[migrate] FAILED:", err);
  process.exit(1);
}
