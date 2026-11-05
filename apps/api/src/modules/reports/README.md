# reports

A generic report module. A report is a definition (params, a query, columns,
an optional chart). The module owns the registry, param validation, date
ranges, the activity-health rule and, in later tasks, the runner, CSV export,
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

## Favorites (injected, not owned)

The module does not create a favorites table. Favorites go through a store the
host injects, backed by the app's generic per-user stars table:

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
