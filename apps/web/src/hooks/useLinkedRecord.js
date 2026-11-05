import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useToast } from "../components/ui/Toast.jsx";
import { errorText } from "../lib/requests.js";

/**
 * A deep link to one record: `?<param>=<id>` in the URL (a notification's
 * link, a pasted URL), read fresh by id so its version is current. A failed
 * read is toasted (`notFoundText` for a 404) and the param removed.
 *
 * → { id, record, open(row), clear(), reload() }; `record` is null until the
 * read for the current id lands. open/clear rewrite only `param`, so a
 * table's own URL state (useDataTable urlKey) is kept.
 */
export function useLinkedRecord(param, fetchById, { notFoundText = "That item was not found." } = {}) {
  const [params, setParams] = useSearchParams();
  const { addToast } = useToast();
  const id = params.get(param);
  const [record, setRecord] = useState(null);
  const [nonce, setNonce] = useState(0);

  const setId = useCallback((next) => setParams((prev) => {
    const out = new URLSearchParams(prev);
    if (next) out.set(param, next);
    else out.delete(param);
    return out;
  }, { replace: true }), [param, setParams]);

  useEffect(() => {
    if (!id) return undefined;
    let live = true;
    fetchById(id)
      .then((r) => { if (live) setRecord(r); })
      .catch((err) => {
        if (!live) return;
        addToast({ message: err?.response?.status === 404 ? notFoundText : errorText(err), type: "error" });
        setId(null);
      });
    return () => { live = false; };
    // fetchById, addToast and notFoundText are read once per id (and per reload).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, nonce]);

  return {
    id,
    record: id && record?.id === id ? record : null,
    open: useCallback((row) => setId(row.id), [setId]),
    clear: useCallback(() => setId(null), [setId]),
    reload: useCallback(() => setNonce((n) => n + 1), []),
  };
}
