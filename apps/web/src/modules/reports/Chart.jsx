import { useEffect, useRef, useState } from "react";
import { chartConfig } from "./chart-spec.js";

/**
 * The one chart wrapper. Chart.js is imported on first use through
 * chart-runtime.js (its own chunk, so it only loads when a chart is drawn),
 * which registers only the pieces these specs need. Colours come from the --chart-* tokens in
 * index.css, read at draw time, so a theme change re-themes the chart.
 * The data table shown with every chart is its accessible fallback.
 *
 *   <Chart spec={{ type, x, series, format? }} rows={rows} columns={columnSpecs} height={240} />
 */
let loading = null;
function loadChartJs() {
  loading ??= import("./chart-runtime.js").then((m) => m.Chart).catch((err) => {
    loading = null; // a failed chunk load can be retried on the next mount
    throw err;
  });
  return loading;
}

const token = (style, name, fallback) => style.getPropertyValue(name).trim() || fallback;

function liveTheme(el) {
  const style = getComputedStyle(el);
  const colors = Array.from({ length: 8 }, (_, i) => token(style, `--chart-${i + 1}`, ""));
  return {
    colors: colors.every(Boolean) ? colors : undefined,
    grid: token(style, "--chart-grid", ""),
    text: token(style, "--chart-text", ""),
    surface: token(style, "--chart-surface", ""),
  };
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function Chart({ spec, rows, columns, height = 240, label }) {
  const canvas = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let chart = null;
    let live = true;
    loadChartJs()
      .then((ChartJs) => {
        if (!live || !canvas.current) return;
        const config = chartConfig(spec, rows, { ...liveTheme(canvas.current), columns });
        if (reducedMotion()) config.options.animation = false;
        chart = new ChartJs(canvas.current, config);
      })
      .catch(() => { if (live) setFailed(true); });
    return () => {
      live = false;
      chart?.destroy();
    };
  }, [spec, rows, columns]);

  if (failed) return <p className="text-xs text-navy/50">The chart could not be drawn; the table below has the same figures.</p>;
  return (
    <div style={{ height }} className="relative w-full">
      <canvas ref={canvas} role="img" aria-label={label ?? "Chart; the table has the same figures."} />
    </div>
  );
}
