import { useEffect, useState } from "react";
import api from "../config/api.js";

/** The server's priced cart — the exact numbers checkout will charge. */
export function useCartQuote(items) {
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const key = JSON.stringify(items.map((i) => [i.variantId, i.qty]));

  useEffect(() => {
    if (items.length === 0) { setQuote(null); setError(null); return; }
    let cancelled = false;
    setLoading(true);
    api.post("/catalog/quote", { items: items.map((i) => ({ variantId: i.variantId, qty: i.qty })) })
      .then((res) => { if (!cancelled) { setQuote(res.data.data); setError(null); } })
      .catch((err) => { if (!cancelled) { setQuote(null); setError(err.response?.data?.error?.message || "Couldn't price your cart."); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { quote, loading, error };
}
