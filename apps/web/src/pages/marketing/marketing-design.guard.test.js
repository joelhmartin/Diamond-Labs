import { test } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";

/* Design-consistency guard for the marketing site: banned copy, hero reuse and
   the saved palette. */

const src = fileURLToPath(new URL("../..", import.meta.url));

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(jsx?|css)$/.test(name) && !/\.test\./.test(name) ? [p] : [];
  });
}

const files = [...walk(join(src, "pages/marketing")), ...walk(join(src, "components/marketing"))];
const read = (p) => readFileSync(p, "utf8");

test("no banned copy appears on marketing pages", () => {
  const banned = [
    /Olmos[- ]Method|Olmos Protocol|System Operational|every micron/i,
    /\b(seven|7) (certified )?(labs|laboratories)\b/i,
    /No analog guesswork/i,
    /gold standard|only lab|only orthotic lab|premier|global authority|built around the Olmos/i,
  ];
  // Checkout.jsx is owned by feat/own-the-lab and has a (555) 123 form placeholder.
  // Only that pattern is exempt for it; every other pattern still applies.
  const placeholder555 = /\(555\) 123/;
  const hits = files
    .filter((p) => banned.some((r) => r.test(read(p))) || (basename(p) !== "Checkout.jsx" && placeholder555.test(read(p))))
    .map((p) => p.replace(src, ""));
  assert.deepEqual(hits, []);
});

test("the nav does not link to the Dr. Olmos page", () => {
  assert.doesNotMatch(read(join(src, "components/marketing/Navbar.jsx")), /\/about\/dr-olmos/);
});

test("only Home, Checkout and PageHero define their own hero", () => {
  const hits = files
    .filter((p) => !["Home.jsx", "Checkout.jsx", "PageHero.jsx"].includes(basename(p)))
    .filter((p) => /\bconst Hero\s*=|\bfunction\s+\w*Hero\b|hero-gradient/.test(read(p)))
    .map((p) => p.replace(src, ""));
  assert.deepEqual(hits, []);
});

const PALETTE = {
  navy: { channels: "17 55 106", hex: "#11376A", editorKey: "navy" },
  "navy-dark": { channels: "0 96 230", hex: "#0060E6", editorKey: "navy-dark" },
  "brand-500": { channels: "31 184 249", hex: "#1FB8F9", editorKey: "brand-500" },
  "brand-600": { channels: "46 156 204", hex: "#2E9CCC", editorKey: "brand-600" },
  "accent-500": { channels: "247 157 30", hex: "#F79D1E", editorKey: "accent-500" },
  // The theme editor mirrors surface-100 as "color-page".
  "surface-100": { channels: "247 247 245", hex: "#F7F7F5", editorKey: "color-page" },
};

test("the saved palette is unchanged in index.css", () => {
  const css = read(join(src, "index.css"));
  for (const [token, { channels }] of Object.entries(PALETTE)) {
    const m = css.match(new RegExp(`^\\s*--${token}:\\s*([\\d ]+);`, "m"));
    assert.equal(m?.[1], channels, `--${token}`);
  }
});

test("the saved palette is unchanged in theme-tokens.js", () => {
  const tokens = read(join(src, "components/theme/theme-tokens.js"));
  for (const [token, { hex, editorKey }] of Object.entries(PALETTE)) {
    const m = tokens.match(new RegExp(`key:\\s*"${editorKey}"[^}]*default:\\s*"(#[0-9A-Fa-f]{6})"`));
    assert.equal(m?.[1].toUpperCase(), hex, `${token} (${editorKey})`);
  }
});
