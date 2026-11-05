import { useCallback, useEffect, useState } from "react";
import api from "../config/api.js";

/**
 * Load `GET path` (`config` is an axios config, e.g. `{ params }`) and keep the
 * unwrapped `data` envelope. `reload()` refetches. The request re-runs when
 * `path` or the serialised `config` changes. Stale responses are dropped.
 */
export function useResource(path, config) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const configKey = JSON.stringify(config ?? null);

  const load = useCallback(async (isCurrent = () => true) => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const res = await api.get(path, config);
      if (isCurrent()) setState({ data: res.data.data, loading: false, error: null });
    } catch (error) {
      if (isCurrent()) setState((s) => ({ ...s, loading: false, error }));
    }
    // `config` is tracked through configKey so a fresh-but-equal object does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, configKey]);

  useEffect(() => {
    let current = true;
    load(() => current);
    return () => { current = false; };
  }, [load]);

  const reload = useCallback(() => load(), [load]);
  return { ...state, reload };
}
