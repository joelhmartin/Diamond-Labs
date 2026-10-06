import { useEffect, useState } from "react";
import api from "../config/api.js";
import { currentQuote, quoteKey, shopperIdentity } from "../lib/catalog.js";
import { useAuthStore } from "../stores/auth.store.js";

/**
 * The server's priced cart — the exact numbers checkout will charge. Waits for
 * the auth check so a doctor is never quoted guest prices, and re-prices when
 * the shopper changes or `requote()` is called.
 */
export function useCartQuote(items) {
  const identity = useAuthStore((s) => shopperIdentity(s));
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState(null); // { key, quote }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const key = quoteKey(items, identity, nonce);

  useEffect(() => {
    if (items.length === 0) { setState(null); setError(null); return; }
    if (identity == null) return; // auth still resolving
    let cancelled = false;
    setLoading(true);
    api.post("/catalog/quote", { items: items.map((i) => ({ variantId: i.variantId, qty: i.qty })) })
      .then((res) => { if (!cancelled) { setState({ key, quote: res.data.data }); setError(null); } })
      .catch((err) => { if (!cancelled) { setState(null); setError(err.response?.data?.error?.message || "Couldn't price your cart."); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Stale quote (cart or shopper changed since) reads as null until the new one lands.
  const quote = currentQuote(state, key);
  return {
    quote,
    loading: loading || (items.length > 0 && !quote && !error),
    error,
    requote: () => setNonce((n) => n + 1),
  };
}
