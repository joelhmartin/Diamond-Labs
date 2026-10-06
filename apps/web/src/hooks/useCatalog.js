import { useCallback, useEffect, useState } from "react";
import api from "../config/api.js";
import { familyToProduct } from "../lib/catalog.js";

export function useCatalog() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/catalog");
      setProducts(res.data.data.families.map(familyToProduct));
    } catch {
      setError("The catalog couldn't be loaded. Please refresh.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);
  return { products, loading, error, reload };
}
