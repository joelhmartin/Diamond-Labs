/**
 * Dashboards: a dashboard is a list of tiles, each backed by a report or a
 * metric. resolveDashboard runs the actor's tiles in parallel through the same
 * machinery as a report run (read-only transaction, statement timeout, a run
 * slot), with a 5 s limit per tile. Each tile succeeds or fails on its own: one
 * failure never fails the dashboard. Tiles the actor may not see (by the tile's
 * own roles or its report/metric's roles) are left out, not shown as errors.
 *
 * Successful tiles are cached per process for 60 s, keyed by tile, params and
 * role. Tiles therefore must not depend on who the actor is beyond their role.
 */
import { runReport, inReadOnlyTx, ReportError, defaultRunSlots } from "./runner.js";
import { paramsSchema } from "./params.js";

export const TILE_TIMEOUT_MS = 5000;
export const CACHE_TTL_MS = 60000;
const CACHE_MAX_ENTRIES = 500;
const GENERIC_MESSAGE = "This tile could not be loaded.";

/** A small TTL cache (oldest entries first, by insertion). `clock` is injectable for tests. */
export function createDashboardCache({ ttlMs = CACHE_TTL_MS, clock = Date.now, max = CACHE_MAX_ENTRIES } = {}) {
  const entries = new Map();
  return {
    get(key) {
      const hit = entries.get(key);
      if (!hit) return undefined;
      if (clock() - hit.at >= ttlMs) {
        entries.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, { at: clock(), value });
      while (entries.size > max) entries.delete(entries.keys().next().value);
    },
    clear: () => entries.clear(),
  };
}

/** The per-process default; tests pass their own. */
export const defaultDashboardCache = createDashboardCache();

/** JSON with sorted keys, so { a, b } and { b, a } share a cache entry. */
const stableJson = (obj) => JSON.stringify(Object.keys(obj).sort().map((k) => [k, obj[k]]));

/** The source definition behind a tile: `{ type: "report" | "metric", def }` (def undefined when unknown). */
function sourceOf(registry, tile) {
  if (tile.report) return { type: "report", def: registry.getReport(tile.report) };
  return { type: "metric", def: tile.metric ? registry.getMetric(tile.metric) : undefined };
}

/** The actor may see the tile: its own roles (if any) and its source's roles. An unknown source stays visible (it errors). */
function tileVisible(registry, actor, tile) {
  if (tile.roles && !tile.roles.includes(actor?.role)) return false;
  const { def } = sourceOf(registry, tile);
  return !def || registry.canView(actor, def);
}

/** Static fields the web needs to draw the tile, whatever its outcome. */
function tileHead(tile, source) {
  const head = { id: tile.id, kind: tile.kind, span: tile.span ?? 1, title: tile.title ?? source.def?.title ?? tile.id };
  if (source.type === "report" && source.def) {
    head.columns = source.def.columns;
    const chart = tile.chart ?? source.def.chart;
    if (chart) head.chart = chart;
  }
  return head;
}

async function runMetric({ def, query, db, actor, slots, now, tz }) {
  let params = query;
  if (def.params) {
    try {
      params = paramsSchema(def).parse(query, { now, tz });
    } catch (err) {
      if (!err?.issues) throw err;
      throw new ReportError("INVALID", "Invalid tile settings");
    }
  }
  return inReadOnlyTx({ db, timeoutMs: TILE_TIMEOUT_MS, slots }, (tx) => def.run(tx, params, actor, { now, tz }));
}

function runTile({ registry, tile, source, query, db, actor, slots, now, tz }) {
  if (!source.def) throw new ReportError("NOT_FOUND", "This tile's source is missing.");
  if (source.type === "report") {
    return runReport({ registry, db, key: tile.report, query, actor, now, tz, slots, timeoutMs: TILE_TIMEOUT_MS });
  }
  return runMetric({ def: source.def, query, db, actor, slots, now, tz });
}

function failure(err, tileId, onTileError) {
  if (err instanceof ReportError) return { code: err.code, message: err.message };
  onTileError?.(tileId, err);
  return { code: "INTERNAL_ERROR", message: GENERIC_MESSAGE };
}

/**
 * `{ key, title, tiles: [{ id, kind, span, title, columns?, chart?, ok: true, data } | { ..., ok: false, error }] }`.
 * `query` carries the dashboard's declared params (others are ignored), laid
 * over each tile's fixed `params`. `tile` resolves one tile only (a feed poll).
 * Throws ReportError NOT_FOUND (unknown dashboard or tile) or FORBIDDEN.
 */
export async function resolveDashboard({
  registry, db, key, query = {}, actor, now = new Date(), tz = "UTC",
  cache = defaultDashboardCache, slots = defaultRunSlots, tile: onlyTile, onTileError,
}) {
  const dash = registry.getDashboard(key);
  if (!dash) throw new ReportError("NOT_FOUND", "Dashboard not found");
  if (!registry.canView(actor, dash)) throw new ReportError("FORBIDDEN", "You cannot view this dashboard");

  let tiles = dash.tiles.filter((t) => tileVisible(registry, actor, t));
  if (onlyTile !== undefined) {
    tiles = tiles.filter((t) => t.id === onlyTile);
    if (!tiles.length) throw new ReportError("NOT_FOUND", "Tile not found");
  }
  const shared = Object.fromEntries(
    (dash.params || []).filter((p) => Object.hasOwn(query, p.name)).map((p) => [p.name, query[p.name]]),
  );

  const resolved = await Promise.all(tiles.map(async (tile) => {
    const source = sourceOf(registry, tile);
    const head = tileHead(tile, source);
    const tileQuery = { ...(tile.params || {}), ...shared };
    const cacheKey = `${dash.key}:${tile.id}|${stableJson(tileQuery)}|${actor?.role ?? ""}`;
    const hit = cache.get(cacheKey);
    if (hit !== undefined) return { ...head, ok: true, data: hit };
    try {
      const data = await runTile({ registry, tile, source, query: tileQuery, db, actor, slots, now, tz });
      cache.set(cacheKey, data);
      return { ...head, ok: true, data };
    } catch (err) {
      return { ...head, ok: false, error: failure(err, tile.id, onTileError) };
    }
  }));
  return { key: dash.key, title: dash.title, tiles: resolved };
}
