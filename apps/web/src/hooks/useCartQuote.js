import { useEffect, useState } from "react";
import api from "../config/api.js";
import { currentQuote } from "../lib/catalog.js";

/** The server's priced cart — the exact numbers checkout will charge. */
export function useCartQuote(items) {
  const [state, setState] = useState(null); // { key, quote }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const key = JSON.stringify(items.map((i) => [i.variantId, i.qty]));

  useEffect(() => {
    if (items.length === 0) { setState(null); setError(null); return; }
    let cancelled = false;
    setLoading(true);
    api.post("/catalog/quote", { items: items.map((i) => ({ variantId: i.variantId, qty: i.qty })) })
      .then((res) => { if (!cancelled) { setState({ key, quote: res.data.data }); setError(null); } })
      .catch((err) => { if (!cancelled) { setState(null); setError(err.response?.data?.error?.message || "Couldn't price your cart."); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Stale quote (cart changed since) reads as null until the new one lands.
  const quote = currentQuote(state, key);
  return { quote, loading: loading || (items.length > 0 && !quote && !error), error };
}
