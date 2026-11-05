import { test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The generic reports code must stay liftable into any app. This list is
// deliberately stricter than the module-wide vocabulary guard.
const BANNED = /\b(lab|dental|doctor|patient|practice|order|invoice|pan)\b/i;
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../../..");
const ROOTS = [
  here,
  path.join(repo, "apps/web/src/modules/reports"),
  path.join(repo, "packages/shared/src/reports"),
];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

// Tests may name pinned scenarios from the product brief; they are not shipped
// as part of the liftable module surface.
const files = ROOTS.flatMap(walk).filter((f) => !/\.test\.[jt]sx?$/.test(f));

/** README may use domain words only inside its "Wiring it into another app" section. */
function scannable(file, text) {
  if (path.basename(file) !== "README.md") return text;
  return text.replace(/^## Wiring it into another app[\s\S]*?(?=^## |\s*$(?![\s\S]))/m, "");
}

test("the generic reports code contains no domain words", () => {
  expect(files.length).toBeGreaterThan(3);
  const hits = [];
  for (const f of files) {
    scannable(f, fs.readFileSync(f, "utf8")).split("\n").forEach((line, i) => {
      if (BANNED.test(line)) hits.push(`${path.relative(repo, f)}:${i + 1}: ${line.trim()}`);
    });
  }
  expect(hits).toEqual([]);
});
