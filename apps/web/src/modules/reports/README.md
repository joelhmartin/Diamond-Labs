# reports (web)

## Purpose

The screens for the generic reports module (`apps/api/src/modules/reports`).
Everything here is driven by the report metadata the API serves: params,
columns and paging are data, so a new report needs no web code.

## Public interface

### Pieces

| File | What it does |
|---|---|
| `api.js` | `listReports()`, `runReport(key, params, paging?)`, `downloadReportCsv(key, params)`, `setFavorite(key, on)`, `searchLookup(source, q)` through the signed-in axios client. |
| `params.js` | Params are the raw query strings the server parses: `dateRange` is a preset name or `from..to`, multiselect is comma-joined, toggle is `"true"`/`"false"`. `readParams(specs, searchParams)` overlays `p.<name>` from the URL on the spec defaults; `writeParams` writes them back. |
| `useReport(key)` | `{ meta, metaError, params, setParams, result, lastResult, loading, error, run, load, runKey }`. `lastResult` is the latest successful result and survives a failed run (the Wall view shows it with a "Couldn't refresh" badge); `result` is cleared by an error. Client-paged reports run on load and when params change or `run()` is called. Server-paged reports are fetched page by page by `ReportTable` through `load({ limit, offset, sort })`. |
| `columns.jsx` | `toTableColumns(specs)`: each column formats with the shared `formatCell`, exports with `csvValue`, sorts on the raw value (link/badge objects by label) unless `sortable: false`, and renders a `<Link>` when the spec has a `link` template such as `/x/{id}` (filled from the row; no link when a field is missing). `sortParam(sort)` gives the server's `id` / `-id`. |
| `ReportTable` | `<ReportTable report result params onExportAll? load runKey loading error reload />`: the shared `DataTable`, client or server mode from `report.paging`, `urlKey` `"r"`. Search covers text, link and badge columns (client mode). The toolbar's "Export CSV" saves the whole result from `/reports/:key/export.csv` with the current params; the bulk bar exports the selected rows. The result's `notice` and the `truncated` note sit above the rows; `summary` is a totals row keyed by column id. |
| `ReportParamsForm` | The shared param controls (`ParamFields` in `components/ui/params`, the same controls the export screen draws) plus Run. Picks (selects, presets, toggles, lookups, dates) apply at once; typed values (numbers, a custom range) apply on Run. Lookups search through `searchLookup` / `lookupLabel`. |
| `ReportsIndexPage` | Search over title, description and group; sections Favorites (the person's stars), the featured section (titled by the server's `featuredTitle`), then the groups in the server's sequence; an optimistic star toggle that reverts with a toast; unavailable reports are greyed out, not links. |
| `ReportPage` | `/reports/:key`: the form, the chart (client-paged reports with a `chart` spec), the table, then "N rows · took 0.4 s". A report with `display: "wall"` gets a "Wall view" button that moves the chart and table into `WallView`. |
| `WallView` | `<WallView title onExit rerun generatedAt>{chart and table}</WallView>`: a full-screen fixed overlay (role dialog) with large type that calls `rerun()` every 60 s while the page is visible. Esc or "Exit" closes it. |
| `useVisibleInterval(callback, ms, enabled?)` | Calls `callback` every `ms` only while the page is visible; visible again calls it at once and resumes. Used by `FeedTile` (30 s) and `WallView` (60 s). |
| `chart-spec.js` | `chartConfig(spec, rows, { colors?, grid?, text?, surface?, columns? })`: pure spec → Chart.js config. `line`, `bar`, `groupedBar` (one dataset per series, side by side) and `stackedBar` (stacked scales). Series take the `--chart-1..8` slots by position; bars ≤ 24px with a 4px rounded end; 2px lines; legend only for 2+ series; compact y ticks (money is cents shown as dollars); tooltips use `formatCell`. |
| `Chart` | `<Chart spec rows columns? height? label? />`: dynamically imports `chart-runtime.js` (registers only Bar/Line controllers, Category/Linear scales, Bar/Line/Point elements, Tooltip, Legend), so Chart.js is its own chunk. Reads the colour tokens from `index.css` at draw time; honours reduced motion. |
| `StatTile` | `<StatTile title value previous? format href? detail? />`: the value through `formatCell` by `format` (a column type), and the change vs `previous` as ▲/▼ and a % (none when previous is missing or 0). `href` makes it a link. `detail` (`[{ id, label, value, format? }]`) reads "35 declining · 111 inactive" under the value. |
| `FeedTile` | `<FeedTile rows columns reload? />`: the last 50 events; the first date/datetime column is the time; a row's `href` (an app path) makes its line a link. Calls `reload()` every 30 s only while the page is visible (`useVisibleInterval`); hidden stops it, visible again refreshes at once, unmount stops it. |
| `DashboardPage` | `/…/dashboard/:key?`: tabs from `GET /dashboards` (the first opens when there is no key), then the tile grid (`span` 1–4). Each tile shows its own data or its own error. Chart tiles have a "Show table" fallback; table tiles are a compact `DataTable`. The feed tile's `reload` refetches only that tile (`GET /dashboards/:key?tile=<id>`) and patches it in. |

### Params and errors

Params cleared to blank stay blank: a param with a default that is not
`required` is kept as `p.<name>=` in the URL and sent blank, which the server
reads as unset. Run with changed values writes them (the change runs the report
once); Run with nothing changed reruns. A half-filled custom range disables Run.
Server-paged tables go back to page 1 when params change (`useDataTable`'s
`resetOn`), in the same fetch.

Errors show the server's message (for example a timeout's "This report took
too long. Try a shorter date range.") inside the table, with Retry.

## Configuration

None of its own. Everything comes from the report metadata the API serves. Colours are the
`--chart-1..8` tokens in `index.css`; the timezone and roles live on the API side.

## Data model

None. State is the URL (`p.<name>` params, table paging under `r`) and the API's responses.

## Wiring it into another app

1. Mount the pages (any layout that provides the app's auth and toast context). The paths below
   are examples (or any prefix): the pages link to each other only through the app's route config
   (`ROUTES.REPORTS`, `reportPath(key)`, `dashboardPath(key)`), so mount them wherever those point:

   ```jsx
   <Route path="/reports" element={<ReportsIndexPage />} />
   <Route path="/reports/:key" element={<ReportPage />} />
   <Route path="/dashboard" element={<DashboardPage />} />
   <Route path="/dashboard/:key" element={<DashboardPage />} />
   ```

2. Add the paths to the app's route config (`/reports/:key` needs a `reportPath(key)` helper that
   URL-encodes the key) and to the sidebar: a "Reports" entry for the index, and a "Dashboard" entry
   for `/dashboard` with `end: false` so it stays active on `/dashboard/:key`.
3. The API must serve `/api/v1/reports` and `/api/v1/dashboards` (see the API module README); the
   screens use the app's signed-in axios client.
4. A new report needs no web code. Dashboard tiles that link into the app use `href` and `link`
   templates, so the app's paths are the only coupling.
5. Copy `apps/web/src/components/ui/params` too: the param controls and the `LookupField` typeahead
   (`<LookupField source value onChange search labelFor? />`) the form draws with.
6. Charts load Chart.js as its own chunk on first use; `pnpm --filter @my-app/web build` shows it.
