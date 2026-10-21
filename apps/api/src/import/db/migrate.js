/**
 * Apply the import DB's own migrations (./migrations) to IMPORT_DATABASE_URL,
 * which must name diamond_labs_import. Operator machine only.
 *
 *   IMPORT_DATABASE_URL=… pnpm --filter @my-app/api import:db:migrate
 */
import { runMigrations } from "../../db/run-migrations.js";
import { assertNotCloudRun, resolveImportDb } from "../targets.js";

try {
  assertNotCloudRun(process.env);
  const { url } = resolveImportDb(process.env);
  await runMigrations({ url, migrationsFolder: new URL("./migrations", import.meta.url).pathname, label: "import-db" });
  process.exit(0);
} catch (err) {
  console.error(`[import-db] ${err?.message || err}`);
  process.exit(1);
}
