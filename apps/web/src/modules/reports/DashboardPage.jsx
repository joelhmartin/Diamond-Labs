import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertCircle, Loader2 } from "lucide-react";
import { dashboardPath } from "../../config/routes.js";
import { errorText } from "../../lib/requests.js";
import { useLatestRequest } from "../../hooks/useLatestRequest.js";
import { DataTable } from "../../components/ui/data-table/index.js";
import { useDataTable } from "../../hooks/useDataTable.js";
import { listDashboards, getDashboard } from "./api.js";
import { toTableColumns, keyed, getRowId } from "./columns.jsx";
import { Chart } from "./Chart.jsx";
import { StatTile } from "./StatTile.jsx";
import { FeedTile } from "./FeedTile.jsx";

// Literal classes so Tailwind keeps them. Four columns on wide screens, two on small.
const SPAN = { 1: "", 2: "sm:col-span-2", 3: "sm:col-span-2 lg:col-span-3", 4: "sm:col-span-2 lg:col-span-4" };

/**
 * Dashboards: tabs for every dashboard the person may see, then a grid of
 * tiles. Each tile loads and fails on its own (the server resolves them
 * independently; a failed tile carries its own message). With no key in the
 * URL the first dashboard opens. The feed tile refetches only itself.
 */
export function DashboardPage() {
  const { key } = useParams();
  const [list, setList] = useState(null);
  const [listError, setListError] = useState(null);
  const [state, setState] = useState({ data: null, error: null, loading: false });
  const latest = useLatestRequest();

  useEffect(() => {
    listDashboards().then((res) => setList(res?.dashboards ?? [])).catch(setListError);
  }, []);

  const activeKey = key ?? list?.[0]?.key;

  useEffect(() => {
    if (!activeKey) return;
    // A new tab starts blank: the previous dashboard's tiles never show under the new title.
    setState({ data: null, error: null, loading: true });
    latest(() => getDashboard(activeKey))
      .then(({ stale, value }) => { if (!stale) setState({ data: value, error: null, loading: false }); })
      .catch((error) => setState({ data: null, error, loading: false }));
  }, [activeKey, latest]);

  // One tile, fresh from the server, patched into the dashboard. A failed poll keeps what is shown.
  const reloadTile = useCallback(async (tileId) => {
    try {
      const res = await getDashboard(activeKey, { tile: tileId });
      const fresh = res?.tiles?.find((t) => t.id === tileId);
      if (!fresh) return;
      setState((s) => (s.data?.key === activeKey
        ? { ...s, data: { ...s.data, tiles: s.data.tiles.map((t) => (t.id === tileId ? fresh : t)) } }
        : s));
    } catch {
      /* keep the last good rows; the next poll tries again */
    }
  }, [activeKey]);

  const { data, error, loading } = state;
  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">{data?.title ?? "Dashboard"}</h1>
        {list && list.length > 0 && <Tabs list={list} activeKey={activeKey} />}
      </header>
      {listError && <Problem>{errorText(listError)}</Problem>}
      {list && list.length === 0 && <p className="text-sm text-navy/50">No dashboards to show.</p>}
      {error && <Problem>{errorText(error)}</Problem>}
      {loading && !data && (
        <p className="inline-flex items-center gap-2 text-sm text-navy/40"><Loader2 size={14} className="animate-spin" /> Loading…</p>
      )}
      {data && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {data.tiles.map((tile) => (
            <div key={tile.id} className={SPAN[tile.span] ?? ""}>
              <Tile tile={tile} reload={tile.kind === "feed" ? () => reloadTile(tile.id) : undefined} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Tabs({ list, activeKey }) {
  return (
    <nav aria-label="Dashboards" className="flex flex-wrap gap-1 rounded-full bg-surface-100 p-1">
      {list.map((d) => {
        const active = d.key === activeKey;
        return (
          <Link
            key={d.key} to={dashboardPath(d.key)} aria-current={active ? "page" : undefined}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${active ? "bg-white text-navy shadow-sm" : "text-navy/60 hover:text-navy"}`}
          >
            {d.title}
          </Link>
        );
      })}
    </nav>
  );
}

function Tile({ tile, reload }) {
  if (tile.ok && tile.kind === "stat") {
    const d = tile.data || {};
    return <StatTile title={tile.title} value={d.value} previous={d.previous} format={d.format} href={d.href} detail={d.detail} />;
  }
  return (
    <section aria-label={tile.title} className="h-full rounded-2xl border border-surface-300/50 bg-white p-5">
      <h2 className="mb-3 font-mono text-[10px] uppercase tracking-widest text-navy/50">{tile.title}</h2>
      {tile.ok ? <TileBody tile={tile} reload={reload} /> : <Problem>{tile.error?.message || "This tile could not be loaded."}</Problem>}
    </section>
  );
}

function TileBody({ tile, reload }) {
  const rows = tile.data?.rows ?? [];
  if (tile.kind === "feed") return <FeedTile rows={rows} columns={tile.columns} reload={reload} />;
  if (tile.kind === "chart" && tile.chart) {
    return (
      <>
        {rows.length > 0
          ? <Chart spec={tile.chart} rows={rows} columns={tile.columns} height={220} label={`${tile.title} chart`} />
          : <p className="text-sm text-navy/50">No data for this period.</p>}
        {/* The figures behind the chart, for screen readers and exact values. */}
        <details className="mt-3 text-xs text-navy/60">
          <summary className="cursor-pointer select-none">Show table</summary>
          <div className="mt-2"><TileTable columns={tile.columns} rows={rows} /></div>
        </details>
      </>
    );
  }
  return <TileTable columns={tile.columns} rows={rows} />;
}

/** A compact, read-only DataTable for a tile's rows. */
function TileTable({ columns: specs = [], rows }) {
  const columns = useMemo(() => toTableColumns(specs), [specs]);
  const keyedRows = useMemo(() => keyed(rows), [rows]);
  const table = useDataTable({ mode: "client", rows: keyedRows, getRowId, initialPageSize: 10 });
  return (
    <DataTable
      table={table} columns={columns} dense selectable={false} searchable={false} exportable={false}
      emptyText="Nothing to show."
    />
  );
}

function Problem({ children }) {
  return (
    <p role="alert" className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
      <AlertCircle size={14} className="shrink-0" /> {children}
    </p>
  );
}
