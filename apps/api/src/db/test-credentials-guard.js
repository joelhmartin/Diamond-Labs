/**
 * Guards for set-test-credentials.js, which writes a KNOWN password onto a real
 * doctor identity wired to a real Seazona client. Pointed at production it would
 * open a live account (with that practice's invoices — PHI) to anyone holding the
 * password. NODE_ENV alone is not a guard: it is often unset, and the script
 * reads the same DATABASE_URL as everything else.
 *
 * Every check fails closed; together they require a deliberate local run.
 */

const ALLOWED_NODE_ENVS = new Set(["development", "test"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
// Production identifiers (Cloud SQL instance IP / project) — belt and braces on
// top of the loopback-only rule.
const PROD_MARKERS = ["34.45.85.116", "diamond-labs-prod", "diamond-labs-db", "/cloudsql/"];

/**
 * Static pre-flight: env + DATABASE_URL shape. Throws with the reason on refusal.
 * @param {Record<string, string|undefined>} env  usually process.env
 */
export function assertTestCredentialsAllowed(env) {
  if (!ALLOWED_NODE_ENVS.has(env.NODE_ENV)) {
    throw new Error(
      `set-test-credentials refuses to run: NODE_ENV must be "development" or "test" (got ${JSON.stringify(env.NODE_ENV ?? null)}).`
    );
  }
  if (env.ALLOW_TEST_CREDENTIALS !== "1") {
    throw new Error("set-test-credentials refuses to run without ALLOW_TEST_CREDENTIALS=1 (explicit opt-in).");
  }

  const url = env.DATABASE_URL || "";
  const lowered = decodeURIComponent(url).toLowerCase();
  const marker = PROD_MARKERS.find((m) => lowered.includes(m));
  if (marker) {
    throw new Error(`set-test-credentials refuses to run: DATABASE_URL looks like production (matches "${marker}").`);
  }

  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("set-test-credentials refuses to run: DATABASE_URL is missing or unparseable.");
  }
  if (!LOOPBACK_HOSTS.has(host.toLowerCase())) {
    throw new Error(
      `set-test-credentials refuses to run: DATABASE_URL host "${host}" is not loopback. It may only target a local database.`
    );
  }
}

/**
 * Runtime check, run against the live connection before any write. A loopback
 * URL can still be a cloud-sql-proxy tunnel into production, so ask the server
 * itself: every Cloud SQL for PostgreSQL instance has the `cloudsqlsuperuser`
 * role; a local install does not.
 * @param {(strings: TemplateStringsArray) => Promise<Array<object>>} sql  postgres-js tagged template
 */
export async function assertNotCloudSql(sql) {
  const rows = await sql`select 1 from pg_roles where rolname = 'cloudsqlsuperuser'`;
  if (rows.length > 0) {
    throw new Error(
      "set-test-credentials refuses to run: the connected database is a Cloud SQL instance (cloudsqlsuperuser role exists) — likely production via a proxy."
    );
  }
}
