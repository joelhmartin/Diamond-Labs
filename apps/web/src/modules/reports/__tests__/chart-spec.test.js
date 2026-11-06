import { test } from "vitest";
import assert from "node:assert/strict";
import { chartConfig, SERIES_FALLBACK, compactTick } from "../chart-spec.js";

const ROWS = [
  { month: "Jan", y2025: 120000, y2026: 150000 },
  { month: "Feb", y2025: 90000, y2026: null },
];
const SERIES = [{ field: "y2025", label: "2025" }, { field: "y2026", label: "2026" }];

test("chartConfig groupedBar makes one dataset per series; stackedBar sets stacked scales", () => {
  const grouped = chartConfig({ type: "groupedBar", x: "month", series: SERIES }, ROWS);
  assert.equal(grouped.type, "bar");
  assert.deepEqual(grouped.data.labels, ["Jan", "Feb"]);
  assert.equal(grouped.data.datasets.length, 2);
  assert.deepEqual(grouped.data.datasets.map((d) => d.label), ["2025", "2026"]);
  assert.deepEqual(grouped.data.datasets[0].data, [120000, 90000]);
  assert.deepEqual(grouped.data.datasets[1].data, [150000, null]);
  assert.notEqual(grouped.options.scales.x.stacked, true);
  assert.notEqual(grouped.options.scales.y.stacked, true);

  const stacked = chartConfig({ type: "stackedBar", x: "month", series: SERIES }, ROWS);
  assert.equal(stacked.type, "bar");
  assert.equal(stacked.options.scales.x.stacked, true);
  assert.equal(stacked.options.scales.y.stacked, true);
});

test("series take palette slots by position, never cycled", () => {
  const colors = ["#111111", "#222222", "#333333"];
  const cfg = chartConfig({ type: "bar", x: "month", series: SERIES }, ROWS, { colors });
  assert.deepEqual(cfg.data.datasets.map((d) => d.backgroundColor), ["#111111", "#222222"]);
  const defaults = chartConfig({ type: "bar", x: "month", series: SERIES }, ROWS);
  assert.equal(defaults.data.datasets[0].backgroundColor, SERIES_FALLBACK[0]);
});

test("line is a 2px line with no fill; bars are capped thin with a rounded data end", () => {
  const line = chartConfig({ type: "line", x: "month", series: SERIES.slice(0, 1) }, ROWS);
  assert.equal(line.type, "line");
  assert.equal(line.data.datasets[0].borderWidth, 2);
  assert.equal(line.data.datasets[0].fill, false);
  const bar = chartConfig({ type: "bar", x: "month", series: SERIES.slice(0, 1) }, ROWS);
  assert.ok(bar.data.datasets[0].maxBarThickness <= 24);
  assert.equal(bar.data.datasets[0].borderRadius.topLeft, 4);
  assert.equal(bar.data.datasets[0].borderRadius.bottomLeft, 0);
});

test("one series has no legend; two or more do", () => {
  assert.equal(chartConfig({ type: "bar", x: "month", series: SERIES.slice(0, 1) }, ROWS).options.plugins.legend.display, false);
  assert.equal(chartConfig({ type: "bar", x: "month", series: SERIES }, ROWS).options.plugins.legend.display, true);
});

test("money axis ticks are compact dollars and tooltips use formatCell", () => {
  const cfg = chartConfig({ type: "bar", x: "month", format: "money", series: SERIES }, ROWS);
  assert.equal(cfg.options.scales.y.ticks.callback(150000), "$1.5K");
  const label = cfg.options.plugins.tooltip.callbacks.label({ dataset: { label: "2026" }, parsed: { y: 150000 } });
  assert.equal(label, "2026: $1,500.00");
  assert.equal(compactTick("int", 2500), "2.5K");
  assert.equal(compactTick("int", 12), "12");
});
