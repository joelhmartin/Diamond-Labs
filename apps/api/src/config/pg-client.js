import postgres from "postgres";

// Cloud SQL hands out unix-socket URLs: postgresql://user:pass@/dbname?host=/cloudsql/INSTANCE.
// postgres-js can't parse the empty host, so those connect through an options
// object. The ONE parser for it: config/database.js, db/run-migrations.js,
// db/scrub-staging.js and the import tools (src/import/targets.js) all connect
// through here. It imports nothing from config/env.js, so the migrate job and
// the import CLIs can use it without the app's env validation.
const SOCKET_URL = /^postgres(?:ql)?:\/\/([^:]+):([^@]+)@\/([^?]+)\?host=(.+)$/;

/** postgres-js arguments for a URL: [url, opts] for TCP, [options] for a Cloud SQL socket. */
export function pgConnectArgs(url, opts = {}) {
  const m = String(url ?? "").match(SOCKET_URL);
  if (!m) return [url, opts];
  return [{
    host: decodeURIComponent(m[4]),
    database: m[3],
    username: decodeURIComponent(m[1]),
    password: decodeURIComponent(m[2]),
    ...opts,
  }];
}

export function createPgClient(url, opts = {}) {
  return postgres(...pgConnectArgs(url, opts));
}
