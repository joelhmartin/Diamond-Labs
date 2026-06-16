/**
 * Diffs the line items WE would generate for a Seazona order against the
 * products on a real hand-made order, by product name.
 *
 * Normalization: lowercase + collapse internal whitespace + trim.
 * Original names are preserved in all output arrays.
 *
 * @param {Array<{name:string}|string>} generated  Line items from our builder
 * @param {Array<{name:string}|string>} real        Line items from a real order
 * @returns {{ matched: string[], missingFromOurs: string[], extraInOurs: string[] }}
 */
export function diffOrderLines(generated, real) {
  // Null-safe: coerce missing/non-string names to "" so real Seazona order
  // data with {name:null} or {} items never throws here.
  const getName = (item) => {
    if (typeof item === "string") return item;
    if (item == null || typeof item.name !== "string") return "";
    return item.name;
  };
  const normalize = (s) => (typeof s !== "string" ? "" : s.toLowerCase().replace(/\s+/g, " ").trim());

  // Filter out items whose name resolved to "" (null / malformed rows).
  const genItems = generated.map(getName).filter((n) => n !== "");
  const realItems = real.map(getName).filter((n) => n !== "");

  const normalizedReal = new Set(realItems.map(normalize));
  const normalizedGen = new Set(genItems.map(normalize));

  const matched = genItems.filter((n) => normalizedReal.has(normalize(n)));
  const extraInOurs = genItems.filter((n) => !normalizedReal.has(normalize(n)));
  const missingFromOurs = realItems.filter((n) => !normalizedGen.has(normalize(n)));

  return { matched, missingFromOurs, extraInOurs };
}
