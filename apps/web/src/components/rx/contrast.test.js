import { test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NAVY = [11, 26, 46];
const WHITE = [255, 255, 255];
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const L = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const over = (a) => NAVY.map((c, i) => Math.round(a * c + (1 - a) * WHITE[i]));
const ratio = (a, b) => { const l1 = L(a), l2 = L(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };

test("every semantic text token clears WCAG AA (4.5:1) on white", () => {
  for (const [name, alpha] of [["text-primary", 1], ["text-secondary", 0.7], ["text-muted", 0.6]])
    assert.ok(ratio(over(alpha), WHITE) >= 4.5, `${name} is ${ratio(over(alpha), WHITE).toFixed(2)}:1`);
});

test("no rx form component renders text below the muted floor", () => {
  // fileURLToPath, not URL.pathname — this repo's path contains a space and
  // pathname would hand back a percent-encoded string that fs cannot read.
  const dir = path.dirname(fileURLToPath(import.meta.url));
  // EVERY .jsx in this directory, not a hand-listed pair. The list used to be
  // ["fields.jsx", "FormRenderer.jsx"], which could not see the failing
  // contrast on the required Doctor Signature label (Signature.jsx, 2.54:1) or
  // the Artboard hint — both of which render inside the consolidated form.
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsx")).sort();
  assert.ok(files.length >= 5, `expected to scan the whole rx component dir, found ${files.length} files`);

  // `text-icon` is the decorative-icon token (3.36:1, clears the 3:1 bar for
  // UI components) and is deliberately not matched here.
  const banned = /text-navy\/(20|25|30|40|45|50)\b/g;
  const offenders = [];
  for (const file of files) {
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    for (const m of src.matchAll(banned)) offenders.push(`${file}: ${m[0]}`);
  }
  assert.deepEqual(offenders, []);
});
