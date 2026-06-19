import { describe, it, expect } from "vitest";
import { themeUpdateSchema } from "@my-app/shared";

describe("themeUpdateSchema", () => {
  it("accepts valid channel + font tokens", () => {
    const r = themeUpdateSchema.safeParse({ tokens: { navy: "10 20 30", "font-sans": "Inter, sans-serif" } });
    expect(r.success).toBe(true);
  });
  it("rejects unknown token keys", () => {
    expect(themeUpdateSchema.safeParse({ tokens: { "evil-key": "1 2 3" } }).success).toBe(false);
  });
  it("rejects malformed channel values", () => {
    expect(themeUpdateSchema.safeParse({ tokens: { navy: "#000000" } }).success).toBe(false);
    expect(themeUpdateSchema.safeParse({ tokens: { navy: "300 0 0" } }).success).toBe(false);
  });
  it("rejects font values with CSS injection chars", () => {
    expect(themeUpdateSchema.safeParse({ tokens: { "font-sans": "x; } body{display:none}" } }).success).toBe(false);
  });
});
