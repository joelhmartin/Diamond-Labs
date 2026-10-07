import { useCallback, useEffect, useRef, useState } from "react";
import api from "../config/api.js";
import { familyToProduct, matchesShopper, shopperIdentity } from "../lib/catalog.js";
import { useAuthStore } from "../stores/auth.store.js";

const EMPTY = [];

/** The shop catalog, priced for the current shopper; re-fetched when that changes. */
export function useCatalog() {
  const identity = useAuthStore((s) => shopperIdentity(s));
  const [catalog, setCatalog] = useState(null); // { identity, products }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const latest = useRef(0); // only the newest request may write (shopper can change mid-fetch)

  const reload = useCallback(async (forIdentity) => {
    const seq = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/catalog");
      if (seq === latest.current) {
        setCatalog({ identity: forIdentity, products: res.data.data.families.map(familyToProduct) });
      }
    } catch {
      if (seq === latest.current) setError("The catalog couldn't be loaded. Please refresh.");
    } finally {
      if (seq === latest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (identity == null) return; // auth still resolving — don't fetch guest prices for a doctor
    reload(identity);
  }, [identity, reload]);

  // Never hand out products priced for a different shopper (e.g. just signed out).
  const current = matchesShopper(catalog, identity);
  return {
    products: current ? catalog.products : EMPTY,
    loading: loading || !current,
    error,
    identity,
    reload: () => reload(identity),
  };
}
