import "dotenv/config";

/**
 * drizzle-kit config for the piece-5 import DB (diamond_labs_import) ONLY.
 * Never point it at the app DB, and never add these tables to drizzle.config.js:
 * import/db/schema.test.js enforces both. Migrations are applied with
 * `pnpm import:db:migrate` (src/import/db/migrate.js), never with db:migrate.
 */
/** @type {import("drizzle-kit").Config} */
export default {
  schema: "./src/import/db/schema.js",
  out: "./src/import/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.IMPORT_DATABASE_URL ?? "postgresql://unused@localhost:5432/diamond_labs_import",
  },
};
