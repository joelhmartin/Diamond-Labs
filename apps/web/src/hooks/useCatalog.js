import { useCallback, useEffect, useRef, useState } from "react";
import api from "../config/api.js";
import { familyToProduct, shopperIdentity } from "../lib/catalog.js";
import { useAuthStore } from "../stores/auth.store.js";

/** The shop catalog, priced for the current shopper; re-fetched when that changes. */
export function useCatalog() {
  const identity = useAuthStore((s) => shopperIdentity(s));
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const latest = useRef(0); // only the newest request may write (shopper can change mid-fetch)

  const reload = useCallback(async () => {
    const seq = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/catalog");
      if (seq === latest.current) setProducts(res.data.data.families.map(familyToProduct));
    } catch {
      if (seq === latest.current) setError("The catalog couldn't be loaded. Please refresh.");
    } finally {
      if (seq === latest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (identity == null) return; // auth still resolving — don't fetch guest prices for a doctor
    reload();
  }, [identity, reload]);
  return { products, loading, error, reload };
}
