import { useMemo } from "react";
import { formatCell } from "@my-app/shared";
import { DataTable } from "../../components/ui/data-table/index.js";
import { useDataTable } from "../../hooks/useDataTable.js";
import { downloadReportCsv } from "./api.js";
import { toTableColumns, searchRows, sortParam, keyed, getRowId } from "./columns.jsx";

const EMPTY = [];

/**
 * A report's DataTable. `paging: "client"` shows the whole `result`;
 * `"server"` fetches each page through `load({ limit, offset, sort })`
 * (useReport), refetching when `runKey` changes and going back to page 1 when
 * `paramsKey` changes. The toolbar's "Export CSV"
 * saves the whole result from the server; the bulk bar exports selected rows.
 */
export function ReportTable({ report, result, params, onExportAll, load, runKey, paramsKey, loading, error, reload }) {
  const server = report.paging === "server";
  const columns = useMemo(() => toTableColumns(report.columns), [report.columns]);
  const rows = useMemo(() => (server ? EMPTY : keyed(result?.rows)), [server, result]);
  const search = useMemo(() => searchRows(columns), [columns]);

  const table = useDataTable({
    mode: server ? "server" : "client",
    rows,
    searchFn: search,
    fetchPage: async ({ page, pageSize, sort }) => {
      const offset = (page - 1) * pageSize;
      const paging = { limit: pageSize, offset };
      const s = sortParam(sort);
      if (s) paging.sort = s;
      const value = await load(paging);
      return { rows: keyed(value?.rows, offset), total: value?.total ?? 0 };
    },
    deps: [server ? runKey : ""],
    resetOn: paramsKey, // new params start again at page 1 (in the same fetch, not a second one)
    urlKey: "r",
    getRowId,
    loading,
    error,
    reload,
  });

  const exportAll = onExportAll ?? (() => downloadReportCsv(report.key, params));
  const banner = <ResultNotes result={result} />;

  return (
    <DataTable
      table={table}
      columns={columns}
      searchable={!server}
      searchPlaceholder="Search this report…"
      exportAll={exportAll}
      exportFileName={`${report.key}-selected.csv`}
      notice={banner}
      footer={result?.summary ? <SummaryRow specs={report.columns} columns={columns} summary={result.summary} /> : null}
      emptyText="No rows for these settings."
    />
  );
}

/** The report's notice (coverage, caveats) and the cut-off note, above the table. */
function ResultNotes({ result }) {
  if (!result?.notice && !result?.truncated) return null;
  return (
    <div className="space-y-2">
      {result.notice && (
        <div role="note" className="rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {result.notice}
        </div>
      )}
      {result.truncated && (
        <div role="note" className="rounded-xl bg-surface-50 px-4 py-2 text-xs text-navy/60">
          Showing the first {result.rows.length.toLocaleString("en-US")} of {Number(result.total).toLocaleString("en-US")} rows.
          Export CSV for every row, or narrow the settings.
        </div>
      )}
    </div>
  );
}

/** `summary` is one totals row keyed by column id; the first column reads "Total" when it has no value. */
function SummaryRow({ specs, columns, summary }) {
  return (
    <tr className="bg-surface-50 text-sm font-semibold text-navy">
      <td />
      {specs.map((spec, i) => {
        const shown = formatCell(spec, summary[spec.id]);
        const col = columns[i];
        return (
          <td key={spec.id} className={`px-4 py-3 ${col.align === "right" ? "text-right" : "text-left"} ${col.className ?? ""}`}>
            {shown || (i === 0 ? "Total" : "")}
          </td>
        );
      })}
    </tr>
  );
}
