# reports

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
  featured?, timeoutMs? /* <= 30000 */, display?: "wall",
});
registry.defineDashboard({ key, title, params?, tiles: [{ id, kind, report?, metric?, span?, roles? }] });
registry.defineMetric({ key, roles?, run(db, params, actor, ctx?) -> { value, previous?, format, href? } });
registry.defineLookup({ key, roles?, search(db, q, actor) -> [{ value, label }], label(db, value) });
registry.provideCapability(name);

registry.listReports(actor) -> [{ ...meta, available, missing }]; // hides reports the actor may not view
registry.getReport(key) / getDashboard / getMetric / getLookup;
registry.canView(actor, def);
```

`defineReport` throws on a duplicate key, an unknown group, param type, column
type or chart type, a bad `paging` or `display`, and `timeoutMs > 30000`.

`paramsSchema(def).parse(query, { now, tz })` coerces query strings, applies
defaults and rejects bad values. Each `dateRange` comes back as
`{ from, to, previous }`, resolved on the calendar day in `tz` (the app's
timezone, not UTC). Custom ranges are checked for `from <= to` and `maxDays`.

`activityHealth({ recent, baseline, lastAt, asOf }, { inactiveDays, declining, stable })`
returns `{ band: "healthy" | "stable" | "declining" | "inactive", trend, isNew }`.
The host chooses the windows and thresholds.

## Running and routes

`runReport({ registry, db, key, query, actor, tz, slots })` validates, then runs
in a read-only transaction after `SET LOCAL statement_timeout` (report
`timeoutMs`, default 10000), inside one of 4 per-process run slots (5 s wait,
then `BUSY`). It throws `ReportError(code)` with code `NOT_FOUND`, `FORBIDDEN`,
`INVALID` (with `field`), `UNAVAILABLE`, `TIMEOUT` or `BUSY`. Server-paged
reports read `limit` (default 50, max 500), `offset` and `sort` from the query;
client-paged results are cut at 5000 rows with `truncated`. `streamCsv` pages a
server report by 2000 up to 100000 rows, one short transaction per page.

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
  and run slots as a report, at 5000 ms each.
- One tile failing never fails the dashboard. A `ReportError` keeps its code and
  message (a timeout says "This report took too long. Try a shorter date
  range."); anything else becomes `INTERNAL_ERROR` with a generic message, and
  the real error goes to `onTileError(tileId, err)` (the routes log it).
- Tiles outside the actor's roles (the tile's `roles`, or its report's or
  metric's) are left out, not shown as errors.
- `tile` resolves that one tile only (a feed tile's poll); unknown or hidden is
  `NOT_FOUND`.
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

(filled in by the final task)
