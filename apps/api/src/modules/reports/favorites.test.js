import { test, expect } from "vitest";
import { createMemoryFavoritesStore } from "./favorites.service.js";

test("memory store stars and unstars per user", async () => {
  const s = createMemoryFavoritesStore();
  await s.set(null, "u1", "a", true);
  await s.set(null, "u1", "b", true);
  await s.set(null, "u2", "a", true);
  await s.set(null, "u1", "b", false);
  expect([...(await s.listKeys(null, "u1"))]).toEqual(["a"]);
  expect([...(await s.listKeys(null, "u2"))]).toEqual(["a"]);
  expect((await s.listKeys(null, "u3")).size).toBe(0);
});
