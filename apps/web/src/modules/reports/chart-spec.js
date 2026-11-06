/**
 * A report's chart spec (data from the API) -> a Chart.js config. Pure, so it
 * is tested without a canvas; Chart.jsx feeds it the live colour tokens.
 *
 *   spec: { type: "line" | "bar" | "groupedBar" | "stackedBar", x, series: [{ field, label }], format? }
 *
 * Marks follow the house data-viz rules: series take palette slots in a fixed
 * sequence (never cycled, never by rank); bars are at most 24px with a 4px
 * rounded data end, square at the baseline; lines are 2px; one hairline grid;
 * a legend only for two or more series; text in text colours, never series colours.
 */
import { formatCell } from "@my-app/shared";

/**
 * Light-mode categorical slots, used when the CSS tokens (--chart-1..8 in
 * index.css) cannot be read, e.g. in tests. Same values as the tokens.
 */
export const SERIES_FALLBACK = Object.freeze([
  "#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948",
]);
export const THEME_FALLBACK = Object.freeze({ grid: "#eeede9", text: "#52514e", surface: "#ffffff" });
export const MAX_SERIES = SERIES_FALLBACK.length;

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** Axis tick text: compact from 1,000 up ("1.5K"); money is integer cents shown as dollars. */
export function compactTick(format, value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  if (format === "money") {
    const dollars = compact.format(Math.abs(n) / 100);
    return `${n < 0 ? "-" : ""}$${dollars}`;
  }
  if (format === "pct") return `${Math.round(n * 100)}%`;
  return compact.format(n);
}

const columnOf = (columns, id) => (columns || []).find((c) => c.id === id);

function datasetFor(kind, i, { colors, surface }) {
  const color = colors[i] ?? SERIES_FALLBACK[i];
  if (kind === "line") {
    return {
      borderColor: color, backgroundColor: color, borderWidth: 2, fill: false, tension: 0,
      pointRadius: 0, pointHoverRadius: 5, pointHoverBorderWidth: 2, pointHoverBorderColor: surface,
      borderJoinStyle: "round", borderCapStyle: "round",
    };
  }
  const stacked = kind === "stackedBar";
  return {
    backgroundColor: color,
    maxBarThickness: 24,
    // Stacked: square segments split by a 2px surface gap. Otherwise a rounded data end, square at the baseline.
    borderRadius: stacked ? 0 : { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 },
    borderSkipped: stacked ? false : "start",
    borderColor: surface,
    borderWidth: stacked ? { top: 2 } : 0,
  };
}

/**
 * `chartConfig(spec, rows, { colors?, grid?, text?, surface?, columns? })`.
 * `columns` (the report's column specs) format the x labels and pick the value
 * format when the spec names none.
 */
export function chartConfig(spec, rows = [], opts = {}) {
  const colors = opts.colors?.length ? opts.colors : SERIES_FALLBACK;
  const theme = { ...THEME_FALLBACK, ...pick(opts, ["grid", "text", "surface"]) };
  const series = (spec.series || []).slice(0, MAX_SERIES);
  const kind = spec.type;
  const stacked = kind === "stackedBar";
  const xColumn = columnOf(opts.columns, spec.x);
  const format = spec.format ?? columnOf(opts.columns, series[0]?.field)?.type ?? "int";

  const labels = rows.map((r) => (xColumn ? formatCell(xColumn, r?.[spec.x]) : String(r?.[spec.x] ?? "")));
  const datasets = series.map((s, i) => ({
    label: s.label ?? s.field,
    data: rows.map((r) => {
      const v = r?.[s.field];
      return v === null || v === undefined || v === "" ? null : Number(v);
    }),
    ...datasetFor(kind, i, { colors, surface: theme.surface }),
  }));

  const axis = (extra) => ({
    grid: { color: theme.grid, lineWidth: 1, drawTicks: false },
    border: { display: false },
    ticks: { color: theme.text, padding: 6, font: { size: 11 } },
    ...extra,
  });

  return {
    type: kind === "line" ? "line" : "bar",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: axis({ stacked: stacked || undefined, grid: { display: false } }),
        y: axis({
          stacked: stacked || undefined,
          beginAtZero: true,
          ticks: { color: theme.text, padding: 6, font: { size: 11 }, maxTicksLimit: 6, callback: (v) => compactTick(format, v) },
        }),
      },
      plugins: {
        legend: {
          display: series.length >= 2,
          position: "top",
          align: "start",
          labels: { color: theme.text, usePointStyle: true, pointStyle: "rectRounded", boxWidth: 8, boxHeight: 8 },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${formatCell({ type: format }, ctx.parsed.y)}`,
          },
        },
      },
    },
  };
}

function pick(obj, keys) {
  return Object.fromEntries(keys.filter((k) => obj[k]).map((k) => [k, obj[k]]));
}
