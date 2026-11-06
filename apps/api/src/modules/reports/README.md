# reports

## Purpose

A generic report module. A report is a definition (params, a query, columns,
an optional chart). The module owns the registry, param validation, date
ranges, the activity-health rule, the runner, CSV export,
dashboards and routes. It knows nothing about the host app's domain or roles.

Shared, browser-safe pieces live in `packages/shared/src/reports/`
(`resolveDateRange`, `formatCell`, `csvValue`, `PARAM_TYPES`, `COLUMN_TYPES`).

## Public interface

```js
const registry = createRegistry({ defaultRoles: ["admin", "staff"] }); // app passes its roles

registry.defineGroup({ key, title, position });
registry.defineReport({
  key, group, title, description?,
  params: [{ name, type, default?, required?, options?, min?, max?, maxDays?, source? }],
  run(db, params, actor, ctx?) -> { rows, total?, summary?, notice? },
  columns: [{ id, label, type, align?, link?, sortable? }],
  chart?: { type: "line" | "bar" | "groupedBar" | "stackedBar", x, series: [{ field, label }] },
  roles?, paging?: "client" | "server", requires?: string[],
  featured?, timeoutMs? /* <= 30000 */, display?: "wall", unlisted?: boolean,
});
registry.defineDashboard({ key, title, params?, tiles: [{ id, kind, report?, metric?, span?, roles? }] });
registry.defineMetric({ key, roles?, run(db, params, actor, ctx?) -> { value, previous?, format, href?, detail? } });
registry.defineLookup({ key, roles?, search(db, q, actor) -> [{ value, label }], label(db, value) });
registry.provideCapability(name);

registry.listReports(actor) -> [{ ...meta, available, missing }]; // hides reports the actor may not view
registry.getReport(key) / getDashboard / getMetric / getLookup;
registry.canView(actor, def);
```

`defineReport` throws on a duplicate key, an unknown group, param type, column
type or chart type, a bad `paging` or `display`, `timeoutMs > 30000`, and a
param named `limit`, `offset` or `sort` (`PAGING_KEYS`: the runner reads those
from the query for server paging).

`run(db, params, actor, ctx)` gets `ctx = { page, now, today, tz }`:

- `page`: `{ limit, offset, sort: { id, desc } | null }` for a server-paged
  report, else `null`.
- `now`: the instant of the run (a `Date`).
- `today`: `now`'s calendar day, `"YYYY-MM-DD"`, in `tz`.
- `tz`: the app's timezone (`createReportRoutes({ tz })`, default UTC).

- `memo(key, fn)`: shares work between the tiles of ONE dashboard run. The first
  caller for a `key` runs `fn`; later callers get the same promise (a failed
  `fn` is forgotten so the next caller retries). Key it on everything the result
  depends on (e.g. include `now`). Outside a dashboard it just calls `fn`. The
  work runs on the first caller's transaction, so use it for reads only.

A metric's `run` gets the same `{ now, today, tz, memo }` (no `page`). Use
`ctx.today` for "today" rather than reading the clock, so a run and its tests
agree on the day.

`featured: true` is read by the web index (`ReportsIndexPage`), which lists the
report in its own section above the groups, titled by the registry's
`featuredTitle`. The module only passes the flag through `listReports` /
`GET /reports`; nothing on the server reads it.

`display: "wall"` marks a report the web can show full screen (large type,
re-run every 60 s while visible).

`unlisted: true` marks a report that exists for a dashboard tile: `listReports`
still returns it (flagged `unlisted`, so its page opens by link) but the web
index leaves it out of every section.

`paramsSchema(def).parse(query, { now, tz })` coerces query strings, applies
defaults and rejects bad values. Each `dateRange` comes back as
`{ from, to, previous }`, resolved on the calendar day in `tz` (the app's
timezone, not UTC); both ends are inclusive. `previous` is the period to
compare with: for `mtd`, `qtd`, `ytd`, `lastMonth`, `lastYear` and `last12m`
the matching calendar period one back (days clamped to the month's length),
for the rolling presets and custom ranges the equal-length window just
before. `resolvePreset(preset, day)` gives the same `{ from, to, previous }`
for a known day. Custom ranges are checked for `from <= to`; custom ranges and
resolved presets alike are checked against `maxDays` (a too-long preset is INVALID on that param).

`activityHealth({ recent, baseline, lastAt, asOf }, { inactiveDays, declining, stable })`
returns `{ band: "healthy" | "stable" | "declining" | "inactive", trend, isNew }`.
The host chooses the windows and thresholds.

## Running and routes

`runReport({ registry, db, key, query, actor, now?, tz, slots })` validates, then runs
in a read-only transaction after `SET LOCAL statement_timeout` (report
`timeoutMs`, default 10000), inside one of 4 per-process run slots (5 s wait,
then `BUSY`). It throws `ReportError(code)` with code `NOT_FOUND`, `FORBIDDEN`,
`INVALID` (with `field`), `UNAVAILABLE`, `TIMEOUT` or `BUSY`. Server-paged
reports read `limit` (default 50, max 500), `offset` and `sort` from the query;
client-paged results are cut at 5000 rows with `truncated` (a run that cuts its
own list returns `truncated: true` and `total`, and the same note shows). `streamCsv`
pages a server report by 2000 up to 100000 rows, one short transaction per page,
and cuts a client-paged report at 100000 rows, not 5000. It writes the report as
an export source (its columns are the fields) through the shared paged writer and
CSV format in `packages/shared/src/exports` (`openExportStream`, `csvFormat`), the
same code the exports module's downloads use; a report file starts
with a UTF-8 BOM, like the exports downloads and the browser's selected-rows export,
so Excel reads non-ASCII names correctly.

`createReportRoutes({ registry, db, preHandler, audit, favorites, tz?, slots?, dashboardCache? })`
returns a Fastify plugin: `GET /reports` (with the registry's `featuredTitle`,
set by `createRegistry({ featuredTitle })`, default "Featured"),
`/reports/:key/run`, `/reports/:key/export.csv`, `PUT|DELETE /reports/:key/favorite`,
`GET /reports/lookups/:source?q=`, `GET /reports/lookups/:source/label?value=`
(`{ value, label }` from the lookup's `label(db, value)`; 404 when it returns
null), `GET /dashboards` (`{ dashboards: [{ key, title, params }] }`) and
`GET /dashboards/:key` (below). `audit(request, action, targetId, metadata)` is
called on export with parameter names only.

A param sent blank (`?n=`) counts as missing for `required` and defaults, except
that an optional param with a default stays unset: the person cleared it. A
param left out of the query takes its default.

## Dashboards

`resolveDashboard({ registry, db, key, query, actor, now?, tz?, cache?, slots?, tile?, onTileError? })`
returns `{ key, title, tiles }`. Each tile is
`{ id, kind, span, title, columns?, chart?, ok: true, data }` or
`{ ..., ok: false, error: { code, message } }`.

- A tile names a `report` (data = the run result) or a `metric` (data =
  `{ value, previous?, format, href? }`), plus optional fixed `params`, `roles`,
  `title`, `span` and `chart`. `query` supplies only the dashboard's declared
  `params`, laid over each tile's own.
- Tiles run in parallel through the same read-only, time-limited transaction
  and run slots as a report, at 5000 ms each, or the report's own `timeoutMs`
  when that is shorter (`tileTimeoutMs`). A metric's `run` gets that
  transaction, never the raw handle.
- A metric's optional `detail` is a list of related counts,
  `[{ id, label, value, format? }]`; the stat tile shows them under the value.
- One tile failing never fails the dashboard. A `ReportError` keeps its code and
  message (a timeout says "This report took too long. Try a shorter date
  range."); anything else becomes `INTERNAL_ERROR` with a generic message, and
  the real error goes to `onTileError(tileId, err)` (the routes log it).
- Tiles outside the actor's roles (the tile's `roles`, or its report's or
  metric's) are left out, not shown as errors.
- `tile` resolves that one tile only (a feed tile's poll); unknown or hidden is
  `NOT_FOUND`. A one-tile request skips the cache read (so a 30 s poll is never
  60 s stale) and refills it.
- Successful tiles are cached in memory per process for 60 s, keyed by
  `dashboard:tile | params | role` (`createDashboardCache({ ttlMs, clock, max })`).
  So a tile must not depend on who the actor is beyond their role.

## Favorites (injected, not owned)

The module does not create a favorites table. Favorites go through a store the
host injects (`createReportRoutes({ ..., favorites })`), for example one backed
by the app's generic per-user stars table. `createMemoryFavoritesStore()` is a
complete in-memory implementation (forgets on restart):

```js
{
  listKeys(db, userId) -> Promise<Set<string>>,   // report keys this user starred
  set(db, userId, key, on) -> Promise<void>,      // star (on = true) or unstar
}
```

## Configuration

- `defaultRoles`: roles allowed to view a report that lists none.
- `tz` (per `parse` call): timezone for date presets.
- Thresholds for `activityHealth`: passed per call.

## Data model

None. Reports read the host's tables through the `db` handle passed to `run`.

## Wiring it into another app

0. **Copy the code.** This directory, `packages/shared/src/reports` and
   `packages/shared/src/exports` (the CSV encoder, paged writer and CSV format the
   export uses), re-exported from the shared package's index, plus
   `apps/web/src/modules/reports` and `apps/web/src/components/ui/params` (the
   param controls and lookup picker the form draws) for the screens.

1. **Registry.** One registry per app, with the roles that may view a report that lists none:

   ```js
   export const reportRegistry = createRegistry({ defaultRoles: ["admin", "staff"], featuredTitle: "Team favorites" });
   registerMyReports(reportRegistry); // groups, lookups, reports, metrics, dashboards
   ```

2. **Favorites store.** The module owns no table and ships no `schema.js`, so there is nothing to
   re-export from the app's drizzle schema and no migration to generate for it. Implement
   `{ listKeys(db, userId), set(db, userId, key, on) }` over whatever per-user stars the app has, or
   use `createMemoryFavoritesStore()` for a demo (forgets on restart).

3. **Mount the routes.** A Fastify plugin; `preHandler` is the app's auth, `audit` records exports:

   ```js
   app.register(
     createReportRoutes({ registry: reportRegistry, db, preHandler: [authenticate], audit, favorites, tz: "America/Chicago" }),
     { prefix: "/api/v1" },
   );
   ```

4. **Define a report.** Group first, then the report (a view of tickets per week):

   ```js
   import { sql } from "drizzle-orm";

   registry.defineGroup({ key: "support", title: "Support", position: 1 });
   registry.defineReport({
     key: "tickets-by-week", group: "support", title: "Tickets by week",
     params: [{ name: "range", type: "dateRange", default: "last30" }],
     columns: [
       { id: "week", label: "Week", type: "date" },
       { id: "opened", label: "Opened", type: "int", align: "right" },
     ],
     chart: { type: "bar", x: "week", series: [{ field: "opened", label: "Opened" }] },
     async run(tx, { range }, actor, ctx) {
       // Weeks of the app's local day (ctx.tz), not the UTC day; the range is inclusive,
       // so `to` ends at the start of the local day after it.
       const result = await tx.execute(sql`
         select to_char(date_trunc('week', created_at at time zone ${ctx.tz}), 'YYYY-MM-DD') as week, count(*)::int as opened
         from tickets
         where created_at >= (${range.from}::date)::timestamp at time zone ${ctx.tz}
           and created_at < (${range.to}::date + 1)::timestamp at time zone ${ctx.tz}
         group by 1 order by 1`);
       const rows = result.rows ?? result; // postgres.js returns the rows array; node-postgres returns { rows }
       return { rows };
     },
   });
   ```

   `run` receives a read-only transaction under a statement timeout, never the raw handle. Money is
   integer cents; the `money` column type formats it. In the CSV export, money is written as plain
   dollars ("1234.50"), `int` as a number, `pct` as the percent figure with one decimal ("-5.0", no
   "%") and `duration_days` as the number of days, so a spreadsheet can sum them.

5. **Roles and capabilities.** A report or tile with no `roles` takes `defaultRoles`; list `roles` to
   narrow it (the routes answer 403 outside them, and a dashboard leaves the tile out). A report
   with `requires: ["billing"]` is listed but greyed out (`available: false`) until the app calls
   `registry.provideCapability("billing")`, so reports can ship ahead of the feature they need.

6. **Host settings.** Anything a definition needs from the environment (for example a
   "data starts on" date the app validates in its env schema, such as `REPORTS_COVERAGE_FROM`) is
   read by the host's definitions, not by this module.

7. **Web.** See `apps/web/src/modules/reports/README.md` for the routes and sidebar entries.

8. **Bench.** Indexes are the app's schema concern. `pnpm --filter @my-app/api reports:bench --seed`
   runs every available report and dashboard against synthetic data and fails any run over 2 s. It needs
   `DATABASE_URL` pointing at a local database named exactly `diamond_labs_bench` and refuses any other;
   `--seed` drops, recreates, migrates and fills it.
