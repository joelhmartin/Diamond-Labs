import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useLatestRequest } from "../../hooks/useLatestRequest.js";
import * as reportsApi from "./api.js";
import { readParams, writeParams, paramsKey } from "./params.js";

/**
 * One report's state. `meta` comes from the report list (null while loading;
 * `metaError` when the key is unknown or the list failed). `params` are the
 * raw query values: the spec defaults overlaid with `p.<name>` from the URL,
 * so a report link is shareable; `setParams` writes them back to the URL.
 *
 * Client-paged reports run on load and whenever params or `run()` change.
 * Server-paged reports are fetched page by page by ReportTable through
 * `load(paging)`, keyed on `runKey`; `result` is always the latest response.
 */
export function useReport(key) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [meta, setMeta] = useState(null);
  const [metaError, setMetaError] = useState(null);
  const [result, setResult] = useState(null);
  // The latest successful result; unlike `result` it survives a failed run (the Wall view keeps showing it).
  const [lastResult, setLastResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [runId, setRunId] = useState(0);
  const latest = useLatestRequest();

  useEffect(() => {
    let live = true;
    setMeta(null);
    setMetaError(null);
    setResult(null);
    setLastResult(null);
    reportsApi.listReports()
      .then((list) => {
        if (!live) return;
        const found = list?.reports?.find((r) => r.key === key);
        if (found) setMeta(found);
        else setMetaError(new Error("Report not found."));
      })
      .catch((err) => { if (live) setMetaError(err); });
    return () => { live = false; };
  }, [key]);

  // searchParams also changes when the table mirrors its own state (r.*): key on the p.* values only.
  const fresh = meta ? readParams(meta.params, searchParams) : null;
  const pKey = fresh ? paramsKey(fresh) : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps -- pKey stands in for `fresh`
  const params = useMemo(() => fresh ?? {}, [pKey]);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const specs = meta?.params;
  const setParams = useCallback(
    (next) => setSearchParams((prev) => writeParams(prev, next, specs), { replace: true }),
    [setSearchParams, specs],
  );

  const load = useCallback(async (paging) => {
    setLoading(true);
    try {
      const { stale, value } = await latest(() => reportsApi.runReport(key, paramsRef.current, paging));
      if (stale) return null;
      setResult(value);
      setLastResult(value);
      setError(null);
      setLoading(false);
      return value;
    } catch (err) {
      setResult(null);
      setError(err);
      setLoading(false);
      throw err;
    }
  }, [key, latest]);

  const runnable = Boolean(meta?.available);
  const serverPaged = meta?.paging === "server";
  useEffect(() => {
    if (!runnable || serverPaged) return;
    load().catch(() => {}); // the error is in state
  }, [runnable, serverPaged, load, pKey, runId]);

  const run = useCallback(() => setRunId((n) => n + 1), []);

  // paramsKey: changes only when params do (the table goes back to page 1); runKey also changes on Run.
  return { meta, metaError, params, setParams, result, lastResult, loading, error, run, load, paramsKey: pKey, runKey: `${pKey}#${runId}` };
}
