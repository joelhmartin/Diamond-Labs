/**
 * Reports bench: runs every available report and dashboard against a real,
 * local Postgres holding about 21k synthetic orders, and fails if any one takes
 * over 2 s (spec "Performance").
 *
 *   createdb diamond_labs_bench
 *   DATABASE_URL=postgresql://bif@localhost:5432/diamond_labs_bench pnpm --filter @my-app/api reports:bench --seed
 *
 * --seed drops and recreates diamond_labs_bench, migrates it with the app's own
 * migrations and inserts the synthetic data (reports-bench-seed.js). Without
 * it the bench runs against whatever the bench database already holds.
 *
 * It only ever touches a database named exactly diamond_labs_bench on this
 * machine; any other DATABASE_URL is refused before a connection is opened.
 * Reports run as an admin with default params through the real runner (a
 * read-only transaction under statement_timeout); dashboards run through
 * resolveDashboard with an empty cache. Server-paged reports time their first page.
 */
import { pathToFileURL, fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

export const BENCH_DATABASE = "diamond_labs_bench";
export const LIMIT_MS = 2000;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const BENCH_ACTOR = Object.freeze({ id: "bench-admin", role: "admin" });

/** The only query parameters the bench accepts. postgres.js turns any other key into a startup option (`database`, `options`, …). */
const ALLOWED_PARAMS = new Set(["sslmode"]);

/** A connection URL built only from validated parts: user, password, local host, port, `/<database>`, allowed params. */
function rebuild(parsed, database) {
  const u = new URL(`postgresql://${parsed.host}/${database}`);
  u.username = parsed.username;
  u.password = parsed.password;
  for (const [k, v] of parsed.searchParams) u.searchParams.set(k, v);
  return u.toString();
}

/**
 * The URL every bench connection uses: `url` rebuilt from its validated parts
 * when it names exactly diamond_labs_bench on this machine; throws otherwise.
 * Never connect with the raw DATABASE_URL: a query string can redirect
 * postgres.js to another database (`?database=…`) whatever the path says.
 */
export function benchUrl(url) {
  const refuse = (why) => {
    throw new Error(`reports bench: refusing ${why}. DATABASE_URL must be a local postgres URL for ${BENCH_DATABASE}.`);
  };
  let parsed;
  try {
    parsed = new URL(String(url ?? ""));
  } catch {
    return refuse("an unreadable DATABASE_URL");
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) refuse(`protocol ${parsed.protocol}`);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (name !== BENCH_DATABASE) refuse(`database "${name}"`);
  if (!LOCAL_HOSTS.has(parsed.hostname)) refuse(`host "${parsed.hostname}"`);
  const extra = [...parsed.searchParams.keys()].filter((k) => !ALLOWED_PARAMS.has(k));
  if (extra.length) refuse(`query parameter(s) ${extra.join(", ")}`);
  return rebuild(parsed, BENCH_DATABASE);
}

/** The database name when `url` is acceptable to the bench (see benchUrl); throws otherwise. */
export function assertBenchUrl(url) {
  benchUrl(url);
  return BENCH_DATABASE;
}

/** The same server's maintenance database, for DROP / CREATE of the bench database. Takes a benchUrl() result. */
export const maintenanceUrl = (safeUrl) => rebuild(new URL(safeUrl), "postgres");

async function recreateAndSeed(url) {
  const { default: postgres } = await import("postgres");
  const admin = postgres(maintenanceUrl(url), { max: 1, onnotice: () => {} });
  try {
    // BENCH_DATABASE is a constant, never taken from the URL.
    await admin.unsafe(`drop database if exists ${BENCH_DATABASE} with (force)`);
    await admin.unsafe(`create database ${BENCH_DATABASE}`);
  } finally {
    await admin.end({ timeout: 5 });
  }
  const { runMigrations } = await import("../src/db/run-migrations.js");
  await runMigrations({ url, migrationsFolder: fileURLToPath(new URL("../src/db/migrations", import.meta.url)), label: "bench" });

  const { seedPlan, seedDatabase } = await import("./reports-bench-seed.js");
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const t0 = performance.now();
    const counts = await seedDatabase(drizzle(client), seedPlan());
    await client.unsafe("analyze");
    console.log(`[bench] seeded in ${Math.round(performance.now() - t0)} ms:`, counts);
  } finally {
    await client.end({ timeout: 5 });
  }
}

/** Times one call; `{ ms, error?, note? }`. */
async function timed(fn) {
  const t0 = performance.now();
  try {
    const note = await fn();
    return { ms: Math.round(performance.now() - t0), note };
  } catch (err) {
    return { ms: Math.round(performance.now() - t0), error: err?.message ?? String(err), cause: err?.cause?.message };
  }
}

async function benchAll({ registry, db, tz }) {
  const { runReport, createRunSlots } = await import("../src/modules/reports/runner.js");
  const { resolveDashboard, createDashboardCache } = await import("../src/modules/reports/dashboards.js");
  const slots = createRunSlots();
  const results = [];
  const reports = registry.listReports(BENCH_ACTOR);
  for (const def of reports.filter((d) => d.available)) {
    const r = await timed(async () => {
      const out = await runReport({ registry, db, key: def.key, query: {}, actor: BENCH_ACTOR, tz, slots });
      return def.paging === "server" ? `page 1, ${out.rows.length} of ${out.total}` : `${out.rows.length} rows`;
    });
    results.push({ key: def.key, ...r });
  }
  for (const dash of registry.listDashboards(BENCH_ACTOR)) {
    const tileErrors = [];
    const r = await timed(async () => {
      const out = await resolveDashboard({
        registry, db, key: dash.key, actor: BENCH_ACTOR, tz, slots, cache: createDashboardCache(),
        onTileError: (id, err) => tileErrors.push(`${id}: ${err?.message}${err?.cause ? ` (${err.cause.message})` : ""}`),
      });
      for (const t of out.tiles.filter((x) => !x.ok)) {
        if (!tileErrors.some((e) => e.startsWith(`${t.id}:`))) tileErrors.push(`${t.id}: ${t.error.code} ${t.error.message}`);
      }
      if (tileErrors.length) throw new Error(`tiles failed: ${tileErrors.join("; ")}`);
      return `${out.tiles.length} tiles`;
    });
    results.push({ key: `dashboard:${dash.key}`, ...r });
  }
  const skipped = reports.filter((d) => !d.available).map((d) => d.key);
  return { results, skipped };
}

function printTable(results, skipped) {
  const width = Math.max(...results.map((r) => r.key.length));
  console.log(`\n${"key".padEnd(width)}  ${"ms".padStart(6)}  result`);
  for (const r of [...results].sort((a, b) => b.ms - a.ms)) {
    const flag = r.error ? `ERROR ${r.error}${r.cause ? ` | ${r.cause}` : ""}` : r.ms > LIMIT_MS ? `OVER ${LIMIT_MS} ms (${r.note})` : r.note;
    console.log(`${r.key.padEnd(width)}  ${String(r.ms).padStart(6)}  ${flag}`);
  }
  console.log(`\n${results.length} runs; skipped (capability not present): ${skipped.length ? skipped.join(", ") : "none"}`);
}

export async function main(argv = process.argv.slice(2)) {
  // Every connection below uses this rebuilt URL, never the raw DATABASE_URL.
  const url = benchUrl(process.env.DATABASE_URL);
  // config/database.js (imported by the billing services the reports reuse) builds its own client from the env.
  process.env.DATABASE_URL = url;
  if (argv.includes("--seed")) await recreateAndSeed(url);

  // The billing services the reports reuse import config/env.js, which wants a
  // JWT secret. The bench issues no tokens; a placeholder satisfies validation.
  process.env.JWT_SECRET ||= "reports-bench-placeholder-not-a-secret-000000";
  const [{ default: postgres }, { drizzle }, schema, shared, { createRegistry }, { registerLabReports }, appDb] = await Promise.all([
    import("postgres"), import("drizzle-orm/postgres-js"), import("../src/db/schema/index.js"), import("@my-app/shared"),
    import("../src/modules/reports/registry.js"), import("../src/services/lab/reports/index.js"), import("../src/config/database.js"),
  ]);
  const registry = createRegistry({ defaultRoles: shared.STAFF_ROLES, featuredTitle: "Lab favorites" });
  registerLabReports(registry);
  const client = postgres(url, { max: 5, onnotice: () => {} });
  try {
    const { results, skipped } = await benchAll({ registry, db: drizzle(client, { schema }), tz: shared.LAB_TIMEZONE });
    printTable(results, skipped);
    const failed = results.filter((r) => r.error || r.ms > LIMIT_MS);
    if (failed.length) console.error(`\n[bench] FAIL: ${failed.map((r) => r.key).join(", ")}`);
    return failed.length ? 1 : 0;
  } finally {
    await client.end({ timeout: 5 });
    await appDb.queryClient.end({ timeout: 5 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code), (err) => {
    console.error(`[bench] ${err?.message ?? err}`);
    process.exit(1);
  });
}
