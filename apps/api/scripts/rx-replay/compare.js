/**
 * Generated order lines vs the lines the lab billed — pure, no I/O.
 *
 * Lines compare as a multiset of product codes. Arch counts where both sides
 * carry one: an arch-less line on either side matches the same code on any
 * arch, but upper vs lower on the same code is a mismatch.
 */

/** "upper"/"lower"/1/2 → Seazona's 1/2; anything else → null. */
export function archNum(a) {
  if (a === 1 || a === 2) return a;
  if (a === "1" || a === "2") return Number(a);
  if (typeof a === "string") {
    const l = a.toLowerCase();
    if (l === "upper") return 1;
    if (l === "lower") return 2;
  }
  return null;
}

/**
 * @param {Array<{seazonaCode, name, arch, noteOnly, status, mapKey, sourceLabel}>} generated — linesForDevices output
 * @param {Array<{code, name, arch}>} actual — the lab's billed lines
 */
export function compareLines(generated = [], actual = []) {
  const coded = generated
    .filter((l) => !l.noteOnly && l.seazonaCode)
    .map((l) => ({ code: String(l.seazonaCode), name: l.name ?? null, arch: archNum(l.arch), mapKey: l.mapKey ?? null }));
  const open = generated.filter((l) => !l.noteOnly && !l.seazonaCode).map((l) => l.mapKey || l.sourceLabel || "(unnamed)");
  const left = actual.map((l) => ({ code: String(l.code), name: l.name ?? null, arch: archNum(l.arch) }));

  const take = (pred) => {
    const i = left.findIndex(pred);
    return i < 0 ? null : left.splice(i, 1)[0];
  };
  const matched = [];
  const pending = [];
  // Pass 1: same code, same arch. Pass 2: same code, arch missing on one side.
  for (const g of coded) {
    if (take((a) => a.code === g.code && a.arch === g.arch)) matched.push(g);
    else pending.push(g);
  }
  const extra = [];
  let archLoose = 0;
  for (const g of pending) {
    if (take((a) => a.code === g.code && (a.arch == null || g.arch == null))) {
      matched.push(g);
      archLoose++;
    } else extra.push(g);
  }
  const missing = left;

  return {
    generated: coded,
    open,
    matched,
    extra,
    missing,
    archLoose,
    /** generated == actual and nothing is held */
    exact: extra.length === 0 && missing.length === 0 && open.length === 0,
    /** same, and every arch agreed exactly (no arch-less matches) */
    exactStrictArch: extra.length === 0 && missing.length === 0 && open.length === 0 && archLoose === 0,
    /** every generated coded line is on the lab's order */
    subset: extra.length === 0,
  };
}

/** ["2367","2367","2198"] → "2198 + 2367×2" (sorted, counted). */
export function codeBag(codes) {
  const n = new Map();
  for (const c of codes) n.set(c, (n.get(c) || 0) + 1);
  return [...n]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([c, k]) => (k > 1 ? `${c}×${k}` : c))
    .join(" + ");
}
