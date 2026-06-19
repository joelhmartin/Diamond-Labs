import { describe, it, expect } from "vitest";
import { tokensToCss } from "../theme.js";

describe("tokensToCss", () => {
  it("builds a :root block with -- prefixes", () => {
    expect(tokensToCss({ navy: "10 20 30", "font-sans": "Inter, sans-serif" }))
      .toBe(":root{--navy:10 20 30;--font-sans:Inter, sans-serif;}");
  });
  it("returns empty string for no tokens", () => {
    expect(tokensToCss({})).toBe("");
  });
});
