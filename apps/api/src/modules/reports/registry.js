/**
 * Report registry. One instance per app (createRegistry), so tests and hosts
 * never share state. The module knows nothing about the host's roles: the app
 * passes `defaultRoles` (who may view a report that names no roles of its own).
 */
import { PARAM_TYPES, COLUMN_TYPES, DATE_PRESETS } from "@my-app/shared";

export const MAX_TIMEOUT_MS = 30000;
export const CHART_TYPES = Object.freeze(["line", "bar", "groupedBar", "stackedBar"]);
export const TILE_KINDS = Object.freeze(["stat", "chart", "table", "feed"]);
const PAGING = ["client", "server"];

function fail(msg) {
  throw new Error(msg);
}

function requireKey(kind, map, def) {
  if (!def || !def.key) fail(`${kind} requires a key`);
  if (map.has(def.key)) fail(`${kind} "${def.key}" is already registered`);
}

function validateParam(where, p) {
  if ((p.type === "select" || p.type === "multiselect") && !(Array.isArray(p.options) && p.options.length)) {
    fail(`${where}: ${p.type} param "${p.name}" needs options`);
  }
  if (p.type !== "dateRange" || p.default === undefined) return;
  const d = p.default;
  const isRange = d && typeof d === "object" && typeof d.from === "string" && typeof d.to === "string";
  if (!isRange && !DATE_PRESETS.includes(d)) fail(`${where}: dateRange default for "${p.name}" is not a preset or { from, to }`);
}

const withoutUndefined = (def) => Object.fromEntries(Object.entries(def).filter(([, v]) => v !== undefined));

function validateReport(def, groups) {
  const where = `defineReport("${def.key}")`;
  if (!def.title) fail(`${where} requires a title`);
  if (!groups.has(def.group)) fail(`${where}: unknown group "${def.group}"`);
  if (typeof def.run !== "function") fail(`${where} requires a run function`);
  const names = new Set();
  for (const p of def.params || []) {
    if (!p.name) fail(`${where}: every param needs a name`);
    if (names.has(p.name)) fail(`${where}: duplicate param name "${p.name}"`);
    names.add(p.name);
    if (!PARAM_TYPES.includes(p.type)) fail(`${where}: unknown param type "${p.type}"`);
    validateParam(where, p);
  }
  if (!Array.isArray(def.columns) || def.columns.length === 0) fail(`${where} requires columns`);
  const ids = new Set();
  for (const c of def.columns) {
    if (!c.id) fail(`${where}: every column needs an id`);
    if (ids.has(c.id)) fail(`${where}: duplicate column id "${c.id}"`);
    ids.add(c.id);
    if (!COLUMN_TYPES.includes(c.type)) fail(`${where}: unknown column type "${c.type}"`);
  }
  if (def.timeoutMs !== undefined && !(def.timeoutMs > 0 && def.timeoutMs <= MAX_TIMEOUT_MS)) {
    fail(`${where}: timeoutMs must be between 1 and ${MAX_TIMEOUT_MS}`);
  }
  if (def.paging !== undefined && !PAGING.includes(def.paging)) fail(`${where}: paging must be client or server`);
  if (def.chart && !CHART_TYPES.includes(def.chart.type)) fail(`${where}: unknown chart type "${def.chart.type}"`);
  if (def.display !== undefined && def.display !== "wall") fail(`${where}: display must be "wall"`);
  if (def.requires !== undefined && !Array.isArray(def.requires)) fail(`${where}: requires must be an array`);
}

/** Public metadata: everything except functions. */
function metaOf(def) {
  const { run, ...meta } = def;
  return meta;
}

export function createRegistry({ defaultRoles = [] } = {}) {
  const groups = new Map();
  const reports = new Map();
  const dashboards = new Map();
  const metrics = new Map();
  const lookups = new Map();
  const capabilities = new Set();

  const canView = (actor, def) => {
    const roles = def.roles || defaultRoles;
    return Boolean(actor && roles.includes(actor.role));
  };

  return {
    defineGroup({ key, title, position = 0 }) {
      requireKey("Group", groups, { key });
      groups.set(key, { key, title, position });
    },

    defineReport(def) {
      requireKey("Report", reports, def);
      validateReport(def, groups);
      reports.set(def.key, { paging: "client", params: [], requires: [], ...withoutUndefined(def) });
    },

    defineDashboard(def) {
      requireKey("Dashboard", dashboards, def);
      for (const t of def.tiles || []) {
        if (!t.id) fail(`defineDashboard("${def.key}"): every tile needs an id`);
        if (!TILE_KINDS.includes(t.kind)) fail(`defineDashboard("${def.key}"): unknown tile kind "${t.kind}"`);
      }
      dashboards.set(def.key, { params: [], ...withoutUndefined(def) });
    },

    defineMetric(def) {
      requireKey("Metric", metrics, def);
      if (typeof def.run !== "function") fail(`defineMetric("${def.key}") requires a run function`);
      metrics.set(def.key, def);
    },

    defineLookup(def) {
      requireKey("Lookup", lookups, def);
      if (typeof def.search !== "function") fail(`defineLookup("${def.key}") requires a search function`);
      lookups.set(def.key, def);
    },

    /** Declare that an optional feature the host app has is present. */
    provideCapability(name) {
      capabilities.add(name);
    },
    hasCapability: (name) => capabilities.has(name),

    listGroups: () => [...groups.values()].sort((a, b) => a.position - b.position),

    /** Reports the actor may view, with `available` / `missing` capability flags. */
    listReports(actor) {
      return [...reports.values()]
        .filter((def) => canView(actor, def))
        .map((def) => {
          const missing = (def.requires || []).filter((c) => !capabilities.has(c));
          return { ...metaOf(def), available: missing.length === 0, missing };
        });
    },

    listDashboards: (actor) =>
      [...dashboards.values()].filter((d) => canView(actor, d)).map(metaOf),

    getReport: (key) => reports.get(key),
    getDashboard: (key) => dashboards.get(key),
    getMetric: (key) => metrics.get(key),
    getLookup: (key) => lookups.get(key),
    canView,
  };
}
