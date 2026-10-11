/**
 * Code 128 encoder (pure). Returns bar/space module widths — starting with a
 * bar — for a renderer to draw as rectangles. Code set C (digit pairs) for
 * even-length all-digit text (the lab's order numbers: denser, scans
 * faster); code set B (ASCII 32–126) otherwise. Checked against bwip-js
 * 4.11.4's code128 output for every vector in code128.test.js.
 */

// Symbol value → bar/space widths. 0–102 data, 103 Start A, 104 Start B,
// 105 Start C, 106 Stop (7 elements).
const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];
const START_B = 104;
const START_C = 105;
const STOP = 106;

export { PATTERNS as CODE128_PATTERNS };

/** Symbol values including start, checksum and stop. */
export function code128Values(text) {
  const s = String(text);
  if (s.length === 0) throw new RangeError("Code 128 needs at least one character");
  let values;
  if (/^(\d\d)+$/.test(s)) {
    values = [START_C];
    for (let i = 0; i < s.length; i += 2) values.push(Number(s.slice(i, i + 2)));
  } else {
    values = [START_B];
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if (c < 32 || c > 126) throw new RangeError(`Code 128 set B can't encode ${JSON.stringify(ch)}`);
      values.push(c - 32);
    }
  }
  let sum = values[0];
  for (let i = 1; i < values.length; i++) sum += values[i] * i;
  return [...values, sum % 103, STOP];
}

/** Alternating bar/space widths in modules, bar first. */
export function code128Modules(text) {
  return code128Values(text).flatMap((v) => [...PATTERNS[v]].map(Number));
}
