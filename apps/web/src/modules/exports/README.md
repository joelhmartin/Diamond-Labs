# exports (web)

`<ExportScreen basePath defaultSource? />` is the screen for the generic export
API: a source picker, one control per declared parameter, a paged preview
(`DataTable`, server mode), a format picker and a Download button. It reads
everything from `GET <basePath>`; the contract (sources, params, fields,
formats) is in `apps/api/src/modules/exports/README.md`.

A page mounts it and supplies the title and the default source key. The module
holds no application vocabulary.

## Wiring into another app

1. Copy this directory. It depends on the app's shared `DataTable`,
   `useDataTable` and filter controls, its `api` client, its toast and its
   small request, money and download helpers (`lib/`), the same pieces every
   list in the app uses.
2. Wire the server side first (registry, sources, routes): steps 1 to 4 of
   "Wiring into another app" in `apps/api/src/modules/exports/README.md`.
3. Add a page that renders `<ExportScreen basePath="/admin/exports" defaultSource="<key>" />`,
   where `basePath` is the prefix the routes were mounted under (relative to
   the `api` client's base URL), and give it a route and a sidebar entry.

Nothing here changes per source or per format: a new source or format shows
up in the pickers as soon as the server registers it.
