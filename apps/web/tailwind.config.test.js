import { describe, it, expect } from "vitest";
import config from "./tailwind.config.js";

describe("tailwind color tokens", () => {
  const colors = config.theme.extend.colors;
  const leaves = [];
  const walk = (o) => Object.values(o).forEach((v) =>
    typeof v === "string" ? leaves.push(v) : walk(v));
  walk(colors);

  it("every color value resolves through a CSS variable", () => {
    for (const v of leaves) expect(v).toMatch(/var\(--/);
  });
  it("no raw hex remains in color config", () => {
    for (const v of leaves) expect(v).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
  it("fonts resolve through CSS variables", () => {
    for (const v of Object.values(config.theme.extend.fontFamily))
      expect(v).toMatch(/var\(--font-/);
  });
});
