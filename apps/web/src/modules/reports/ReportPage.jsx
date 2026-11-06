import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertCircle, ArrowLeft, Loader2, Maximize2 } from "lucide-react";
import { ROUTES } from "../../config/routes.js";
import { errorText } from "../../lib/requests.js";
import { useReport } from "./useReport.js";
import { ReportParamsForm } from "./ReportParamsForm.jsx";
import { ReportTable } from "./ReportTable.jsx";
import { Chart } from "./Chart.jsx";
import { WallView } from "./WallView.jsx";

/** "took 0.4 s" (one decimal). */
export const tookText = (ms) => `took ${(Math.max(0, Number(ms) || 0) / 1000).toFixed(1)} s`;

/**
 * One report: params at the top, the chart (if the report has one; the table
 * below is its accessible fallback), then the table (notice, rows, totals),
 * then timing. Runs on load with its defaults. A report with `display: "wall"`
 * also offers a Wall view: the chart and table full screen, re-run every 60 s.
 */
export function ReportPage() {
  const { key } = useParams();
  const report = useReport(key);
  const { meta, metaError, params, setParams, loading, run, load, runKey, paramsKey } = report;
  const [wall, setWall] = useState(false);
  const exitWall = useCallback(() => setWall(false), []);
  const canWall = meta?.display === "wall";
  // On the wall a failed re-run keeps the last good figures up (with a badge) instead of blanking the screen.
  // The normal page is unchanged: an error replaces the result.
  const stale = wall && Boolean(report.error) && Boolean(report.lastResult);
  const result = stale ? report.lastResult : report.result;
  const error = stale ? null : report.error;

  const body = meta && (
    <>
      {/* A server-paged result holds one page only, so it is never charted. */}
      {meta.chart && meta.paging !== "server" && result?.rows?.length > 0 && (
        <section aria-label="Chart" className="rounded-2xl border border-surface-300/50 bg-white p-4">
          <Chart spec={meta.chart} rows={result.rows} columns={meta.columns} height={wall ? 420 : 280} />
        </section>
      )}
      <ReportTable
        report={meta} result={result} params={params}
        load={load} runKey={runKey} paramsKey={paramsKey} loading={loading} error={error} reload={run}
      />
      {result && (
        <p className="text-right font-mono text-[11px] text-navy/40">
          {Number(result.total ?? 0).toLocaleString("en-US")} rows · {tookText(result.tookMs)}
        </p>
      )}
    </>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6 md:p-8">
      <Link to={ROUTES.REPORTS} className="inline-flex items-center gap-1 text-xs font-medium text-navy/50 hover:text-navy">
        <ArrowLeft size={12} /> All reports
      </Link>
      {metaError && <Message tone="error">{errorText(metaError)}</Message>}
      {!meta && !metaError && (
        <p className="inline-flex items-center gap-2 text-sm text-navy/40"><Loader2 size={14} className="animate-spin" /> Loading…</p>
      )}
      {meta && (
        <>
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">{meta.title}</h1>
              {meta.description && <p className="mt-1 max-w-3xl text-sm text-navy/60">{meta.description}</p>}
            </div>
            {canWall && meta.available && (
              <button
                type="button" onClick={() => setWall(true)}
                className="inline-flex shrink-0 items-center gap-2 rounded-full border border-surface-300 px-4 py-2 text-sm font-medium text-navy transition hover:scale-[1.03] hover:bg-surface-50"
              >
                <Maximize2 size={14} aria-hidden="true" /> Wall view
              </button>
            )}
          </header>
          {meta.available ? (
            <>
              <ReportParamsForm specs={meta.params} params={params} onChange={setParams} onRun={run} running={loading} />
              {/* The chart and table render once: in the wall overlay while it is open, else here. */}
              {wall ? (
                <WallView title={meta.title} onExit={exitWall} rerun={run} generatedAt={result?.generatedAt} failed={stale ? report.error : null}>{body}</WallView>
              ) : body}
            </>
          ) : (
            <Message>Not available yet{meta.missing?.length ? `: needs ${meta.missing.join(", ")}` : ""}.</Message>
          )}
        </>
      )}
    </div>
  );
}

function Message({ tone, children }) {
  const cls = tone === "error" ? "bg-red-50 text-red-800" : "bg-surface-50 text-navy/70";
  return (
    <div className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm ${cls}`}>
      {tone === "error" && <AlertCircle size={14} />}
      {children}
    </div>
  );
}
