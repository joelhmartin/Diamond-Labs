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

test.each(models.map((m) => [m.label, m]))("%s has a model file and known looks", (_label, view) => {
  expect(existsSync(`${publicDir}/models/appliances/${view.device}.glb`)).toBe(true);
  expect(view.looks.length).toBeGreaterThan(0);
  for (const look of view.looks) {
    expect(["nylon", "trutaine", "bioflex"]).toContain(look.upper);
    expect(["nylon", "trutaine", "bioflex"]).toContain(look.lower);
  }
});

test("the TMD orthotics can be viewed in each material they are made in", () => {
  const looks = (key) => PRODUCTS[key].images.find((i) => i.is3D).looks.map((l) => l.label);
  expect(looks("ond")).toEqual(["Nylon + Trutaine", "Nylon"]);
  expect(looks("onp")).toEqual(["Trutaine", "Nylon", "Bioflex"]);
});
