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
// This runner reuses the same socket-aware connection logic as
// src/config/database.js (kept in sync — see the socketMatch regex there) so a
// single DATABASE_URL works in every environment. It intentionally does NOT
// import ../config/env.js: the job only needs DATABASE_URL, not the full env
// validation the API service requires.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL is not set");
  process.exit(1);
}

// Cloud SQL unix-socket URL: postgresql://user:pass@/dbname?host=/cloudsql/INSTANCE
// postgres-js can't parse the empty host, so connect via an options object.
const socketMatch = url.match(
  /^postgres(?:ql)?:\/\/([^:]+):([^@]+)@\/([^?]+)\?host=(.+)$/
);
const client = socketMatch
  ? postgres({
      host: decodeURIComponent(socketMatch[4]),
      database: socketMatch[3],
      username: decodeURIComponent(socketMatch[1]),
      password: decodeURIComponent(socketMatch[2]),
      max: 1,
    })
  : postgres(url, { max: 1 });

const migrationsFolder = new URL("./migrations", import.meta.url).pathname;

try {
  console.log(`[migrate] applying migrations from ${migrationsFolder}`);
  await migrate(drizzle(client), { migrationsFolder });
  console.log("[migrate] done — schema is up to date");
} catch (err) {
  console.error("[migrate] FAILED:", err);
  await client.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
}

await client.end({ timeout: 5 });
process.exit(0);
