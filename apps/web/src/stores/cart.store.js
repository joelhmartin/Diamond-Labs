import { create } from "zustand";
import { persist } from "zustand/middleware";
import { migrateCart } from "../lib/catalog.js";

export const useCartStore = create(
  persist(
    (set, get) => ({
      items: [],
      isOpen: false,

      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      toggle: () => set((s) => ({ isOpen: !s.isOpen })),

      add: (product, qty = 1) =>
        set((s) => {
          const existing = s.items.find((i) => i.id === product.id);
          if (existing) {
            return {
              items: s.items.map((i) =>
                i.id === product.id ? { ...i, qty: i.qty + qty } : i
              ),
            };
          }
          return {
            items: [...s.items, { ...product, qty }],
          };
        }),

      remove: (id) =>
        set((s) => ({ items: s.items.filter((i) => i.id !== id) })),

      setQty: (id, qty) =>
        set((s) => {
          if (qty <= 0) {
            return { items: s.items.filter((i) => i.id !== id) };
          }
          return {
            items: s.items.map((i) => (i.id === id ? { ...i, qty } : i)),
          };
        }),

      clear: () => set({ items: [] }),

      count: () => get().items.reduce((n, i) => n + i.qty, 0),

      subtotal: () =>
        get().items.reduce((n, i) => n + i.qty * i.price, 0),
    }),
    { name: "diamond-cart", version: 2, migrate: migrateCart }
  )
);
