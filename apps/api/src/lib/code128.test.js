import { test } from "vitest";
import assert from "node:assert/strict";
import { code128Values, code128Modules, CODE128_PATTERNS } from "./code128.js";

test("every symbol is 11 modules wide in 6 elements; stop is 13 in 7", () => {
  assert.equal(CODE128_PATTERNS.length, 107);
  CODE128_PATTERNS.forEach((p, i) => {
    const sum = [...p].reduce((s, d) => s + Number(d), 0);
    if (i === 106) assert.deepEqual([p.length, sum], [7, 13], "stop");
    else assert.deepEqual([p.length, sum], [6, 11], `symbol ${i}`);
  });
});

test("set B: the reference 'Wikipedia' vector, checksum 88", () => {
  assert.deepEqual(code128Values("Wikipedia"), [104, 55, 73, 75, 73, 80, 69, 68, 73, 65, 88, 106]);
});

test("order numbers use set C (digit pairs), matching bwip-js bar for bar", () => {
  assert.deepEqual(code128Values("100245"), [105, 10, 2, 45, 48, 106]);
  assert.deepEqual(code128Modules("100245"), [
    2, 1, 1, 2, 3, 2, 2, 2, 1, 3, 1, 2, 2, 2, 2, 2, 2, 1, 1, 1, 3, 1, 2, 3, 3, 1, 3, 1, 2, 1, 2, 3, 3, 1, 1, 1, 2,
  ]);
  assert.equal(code128Modules("100245").reduce((s, w) => s + w, 0), 68);
});

test("odd-length numbers fall back to set B", () => {
  assert.equal(code128Values("12345")[0], 104);
});

test("text a scanner can't carry is refused, not silently mangled", () => {
  assert.throws(() => code128Values(""), RangeError);
  assert.throws(() => code128Values("café"), RangeError);
});
