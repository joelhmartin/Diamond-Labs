import { useCallback, useEffect, useState } from "react";
import api from "../config/api.js";
import { useLatestRequest } from "./useLatestRequest.js";

/**
 * Load `GET path` (`config` is an axios config, e.g. `{ params }`) and keep the
 * unwrapped `data` envelope. `reload()` refetches. The request re-runs when
 * `path` or the serialised `config` changes. Only the newest request may write
 * state, whether it came from the effect or `reload()`, and nothing is written
 * after unmount (see useLatestRequest).
 */
export function useResource(path, config) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const latest = useLatestRequest();
  const configKey = JSON.stringify(config ?? null);

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const { stale, value } = await latest(() => api.get(path, config));
      if (!stale) setState({ data: value.data.data, loading: false, error: null });
    } catch (error) {
      setState((s) => ({ ...s, loading: false, error }));
    }
    // `config` is tracked through configKey so a fresh-but-equal object does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest, path, configKey]);

  useEffect(() => { reload(); }, [reload]);

  return { ...state, reload };
}
