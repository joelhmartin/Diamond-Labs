import { useEffect, useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import api from "../../config/api.js";
import { DataTable } from "../../components/ui/data-table/index.js";
import { CONTROL } from "../../components/ui/data-table/FilterControl.jsx";
import { useToast } from "../../components/ui/Toast.jsx";
import { useDataTable } from "../../hooks/useDataTable.js";
import { saveBlob } from "../../lib/download.js";
import { pageParams } from "../../lib/data-table/server.js";
import { blobErrorText, errorText } from "../../lib/requests.js";
import { formatCents } from "../../lib/money.js";
import { ParamsForm, paramsReady, paramsToQuery } from "./ParamsForm.jsx";

const getRowId = (r) => r.__i;

function columnsFor(fields) {
  return fields.map((f) => ({
    id: f.key,
    header: f.label,
    align: f.type === "cents" || f.type === "int" ? "right" : "left",
    cell: (r) => (f.type === "cents" ? formatCents(r[f.key]) : r[f.key] ?? ""),
  }));
}

/** The preview table. Mounted fresh (keyed) whenever the source or its params change, so paging restarts at 1. */
function PreviewTable({ basePath, source, query }) {
  const table = useDataTable({
    mode: "server",
    getRowId,
    fetchPage: async ({ page, pageSize }) => {
      const paging = pageParams({ page, pageSize });
      const { data } = await api.get(`${basePath}/${source.key}/preview`, { params: { ...query, ...paging } });
      const rows = (data.data?.rows ?? []).map((r, i) => ({ ...r, __i: paging.offset + i }));
      return { rows, total: data.data?.total ?? rows.length };
    },
  });
  const columns = useMemo(() => columnsFor(source.fields), [source]);
  return (
    <DataTable
      table={table}
      columns={columns}
      searchable={false}
      selectable={false}
      exportable={false}
      itemLabel="rows"
      emptyText="Nothing matches these options."
    />
  );
}

function filenameFrom(res, fallback) {
  const m = /filename="?([^";]+)"?/i.exec(res.headers?.["content-disposition"] ?? "");
  return m ? m[1] : fallback;
}

/**
 * Pick an export source, set its parameters, preview it page by page and
 * download it in one of the formats the source supports. Everything comes from
 * the descriptors at `GET <basePath>`; see apps/api/src/modules/exports/README.md.
 * `defaultSource` is a source key; the first source is used when it is absent.
 */
export function ExportScreen({ basePath, defaultSource }) {
  const { addToast } = useToast();
  const [sources, setSources] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [sourceKey, setSourceKey] = useState(defaultSource ?? null);
  const [values, setValues] = useState({});
  const [formatKey, setFormatKey] = useState(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let live = true;
    api.get(basePath)
      .then(({ data }) => live && setSources(data.data ?? []))
      .catch((err) => live && setLoadError(errorText(err)));
    return () => { live = false; };
  }, [basePath]);

  const source = sources?.find((s) => s.key === sourceKey) ?? sources?.[0] ?? null;
  const format = source?.formats.find((f) => f.key === formatKey) ?? source?.formats[0] ?? null;
  const ready = source ? paramsReady(source.params, values) : false;
  const query = useMemo(() => (source ? paramsToQuery(source.params, values) : {}), [source, values]);

  const pickSource = (key) => { setSourceKey(key); setValues({}); setFormatKey(null); };

  async function download() {
    setDownloading(true);
    try {
      const res = await api.get(`${basePath}/${source.key}/download.${format.key}`, { params: query, responseType: "blob" });
      saveBlob(filenameFrom(res, `${source.key}.${format.extension}`), res.data);
    } catch (err) {
      addToast({ type: "error", message: await blobErrorText(err) });
    } finally {
      setDownloading(false);
    }
  }

  if (loadError) return <p className="text-sm text-red-600">{loadError}</p>;
  if (!sources) return <Loader2 className="animate-spin text-navy/40" size={20} aria-label="Loading" />;
  if (!source) return <p className="text-sm text-navy/50">Nothing can be exported yet.</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        {sources.length > 1 && (
          <select aria-label="Export" value={source.key} onChange={(e) => pickSource(e.target.value)} className={CONTROL}>
            {sources.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        )}
        <ParamsForm params={source.params} values={values} onChange={(id, v) => setValues((cur) => ({ ...cur, [id]: v }))} />
        <div className="ml-auto flex items-center gap-2">
          <select aria-label="Format" value={format?.key ?? ""} onChange={(e) => setFormatKey(e.target.value)} className={CONTROL}>
            {source.formats.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
          <button
            type="button"
            onClick={download}
            disabled={!ready || !format || downloading}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-brand-500 px-4 text-xs font-semibold text-white transition-all hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            Download
          </button>
        </div>
      </div>

      {ready ? (
        <PreviewTable key={`${source.key}|${JSON.stringify(query)}`} basePath={basePath} source={source} query={query} />
      ) : (
        <p className="rounded-2xl border border-dashed border-surface-300/60 px-6 py-10 text-center text-sm text-navy/50">
          Fill in the options above to preview the export.
        </p>
      )}
    </div>
  );
}
