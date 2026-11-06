import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { PRODUCTS } from "./products";

const publicDir = fileURLToPath(new URL("../../public", import.meta.url));
const models = Object.values(PRODUCTS).flatMap((p) => p.images.filter((i) => i.is3D));

test("every product has a 3D view", () => {
  for (const product of Object.values(PRODUCTS)) {
    expect(product.images.some((i) => i.is3D)).toBe(true);
  }
});

test.each(models.map((m) => [m.modelPath]))("%s exists in public", (modelPath) => {
  expect(existsSync(`${publicDir}${modelPath}`)).toBe(true);
});
