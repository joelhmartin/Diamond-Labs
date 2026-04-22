import { create } from "zustand";
import { persist } from "zustand/middleware";
import { SEED_CATALOG } from "../data/catalog";

/**
 * Live product catalog, hydrated from SEED_CATALOG on first use and
 * persisted to localStorage thereafter. Admin CRUD writes land here.
 *
 * When a real backend exists, swap this store's actions for API calls
 * without changing the component contract.
 */
export const useCatalogStore = create(
  persist(
    (set, get) => ({
      products: SEED_CATALOG,

      all: () => get().products,
      active: () => get().products.filter((p) => p.active),
      byId: (id) => get().products.find((p) => p.id === id),

      upsert: (product) =>
        set((s) => {
          const idx = s.products.findIndex((p) => p.id === product.id);
          if (idx === -1) {
            return { products: [...s.products, product] };
          }
          const next = s.products.slice();
          next[idx] = { ...next[idx], ...product };
          return { products: next };
        }),

      patch: (id, patch) =>
        set((s) => ({
          products: s.products.map((p) =>
            p.id === id ? { ...p, ...patch } : p
          ),
        })),

      toggleActive: (id) =>
        set((s) => ({
          products: s.products.map((p) =>
            p.id === id ? { ...p, active: !p.active } : p
          ),
        })),

      setAvailability: (id, availability) =>
        set((s) => ({
          products: s.products.map((p) =>
            p.id === id ? { ...p, availability } : p
          ),
        })),

      remove: (id) =>
        set((s) => ({
          products: s.products.filter((p) => p.id !== id),
        })),

      resetToSeed: () => set({ products: SEED_CATALOG }),
    }),
    {
      name: "diamond-catalog",
      version: 2,
      migrate: (persisted, version) => {
        // If old cart data predates the active/availability fields, seed from scratch
        if (!persisted || !persisted.products?.[0]?.availability) {
          return { products: SEED_CATALOG };
        }
        return persisted;
      },
    }
  )
);
