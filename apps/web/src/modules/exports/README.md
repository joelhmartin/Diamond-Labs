# exports (web)

`<ExportScreen basePath defaultSource? />` is the screen for the generic export
API: a source picker, one control per declared parameter, a paged preview
(`DataTable`, server mode), a format picker and a Download button. It reads
everything from `GET <basePath>`; the contract (sources, params, fields,
formats) is in `apps/api/src/modules/exports/README.md`.

A page mounts it and supplies the title and the default source key. The module
holds no application vocabulary.
