# reports (web)

The screens for the generic reports module (`apps/api/src/modules/reports`).
Everything here is driven by the report metadata the API serves: params,
columns and paging are data, so a new report needs no web code.

## Pieces

| File | What it does |
|---|---|
| `api.js` | `listReports()`, `runReport(key, params, paging?)`, `downloadReportCsv(key, params)`, `setFavorite(key, on)`, `searchLookup(source, q)` through the signed-in axios client. |
| `params.js` | Params are the raw query strings the server parses: `dateRange` is a preset name or `from..to`, multiselect is comma-joined, toggle is `"true"`/`"false"`. `readParams(specs, searchParams)` overlays `p.<name>` from the URL on the spec defaults; `writeParams` writes them back. |
| `useReport(key)` | `{ meta, metaError, params, setParams, result, loading, error, run, load, runKey }`. Client-paged reports run on load and when params change or `run()` is called. Server-paged reports are fetched page by page by `ReportTable` through `load({ limit, offset, sort })`. |
| `columns.jsx` | `toTableColumns(specs)`: each column formats with the shared `formatCell`, exports with `csvValue`, sorts on the raw value (link/badge objects by label) unless `sortable: false`, and renders a `<Link>` when the spec has a `link` template such as `/x/{id}` (filled from the row; no link when a field is missing). `sortParam(sort)` gives the server's `id` / `-id`. |
| `ReportTable` | `<ReportTable report result params onExportAll? load runKey loading error reload />`: the shared `DataTable`, client or server mode from `report.paging`, `urlKey` `"r"`. Search covers text, link and badge columns (client mode). The toolbar's "Export CSV" saves the whole result from `/reports/:key/export.csv` with the current params; the bulk bar exports the selected rows. The result's `notice` and the `truncated` note sit above the rows; `summary` is a totals row keyed by column id. |
| `ReportParamsForm` | Drawn from the param specs. Picks (selects, presets, toggles, lookups, dates) apply at once; typed values (numbers, a custom range) apply on Run. |
| `LookupField` | `<LookupField source value onChange label? search? />`: a debounced typeahead over `/reports/lookups/:source`. Its only tie to reports is the default `search` prop, so it can move into `components/ui` as a general picker. A value that arrives by URL (not picked in this session) shows as its raw value. |
| `ReportsIndexPage` | Search over title, description and group; sections Favorites (the person's stars), Featured, then the groups in the server's sequence; an optimistic star toggle that reverts with a toast; unavailable reports are greyed out, not links. |
| `ReportPage` | `/reports/:key`: the form, the table, then "N rows · took 0.4 s". |

Errors show the server's message (for example a timeout's "This report took
too long. Try a shorter date range.") inside the table, with Retry.

## Wiring it into another app

(filled in by the final task)
