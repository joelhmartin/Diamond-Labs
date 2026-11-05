import { test } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";

/* Design-consistency guard for the marketing site. Expected to stay red until
   every page has migrated to the shared components. */

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
  const banned = /Olmos[- ]Method|Olmos Protocol|System Operational|555\) 123|every micron/i;
  // Checkout.jsx is owned by feat/own-the-lab and has a (555) 123 form placeholder.
  const hits = files.filter((p) => basename(p) !== "Checkout.jsx" && banned.test(read(p))).map((p) => p.replace(src, ""));
  assert.deepEqual(hits, []);
});

test("the nav does not link to the Dr. Olmos page", () => {
  assert.doesNotMatch(read(join(src, "components/marketing/Navbar.jsx")), /\/about\/dr-olmos/);
});

test("only Home and Checkout define their own hero", () => {
  const hits = files
    .filter((p) => !["Home.jsx", "Checkout.jsx"].includes(basename(p)))
    .filter((p) => /function Hero|hero-gradient/.test(read(p)))
    .map((p) => p.replace(src, ""));
  assert.deepEqual(hits, []);
});

test("the saved palette is unchanged", () => {
  const css = read(join(src, "index.css"));
  const expected = { navy: "17 55 106", "navy-dark": "0 96 230", "brand-500": "31 184 249", "accent-500": "247 157 30" };
  for (const [token, value] of Object.entries(expected)) {
    const m = css.match(new RegExp(`^\\s*--${token}:\\s*([\\d ]+);`, "m"));
    assert.equal(m?.[1], value, `--${token}`);
  }
});
