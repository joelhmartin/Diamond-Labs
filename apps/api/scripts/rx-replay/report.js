/**
 * Replay results → markdown. Pure. Prints codes, product names, option
 * literals and mapKeys only — never answers or free text.
 */
import { codeBag } from "./compare.js";
import { classify } from "./classify.js";

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : "—");

function headline(rows) {
  const n = rows.length;
  const c = (f) => rows.filter(f).length;
  return {
    n,
    exact: c((r) => r.exact),
    exactStrictArch: c((r) => r.exactStrictArch),
    subset: c((r) => r.subset),
    pushable: c((r) => r.pushable),
    held: c((r) => !r.pushable),
    pushableExact: c((r) => r.pushable && r.exact),
    pushableWrong: c((r) => r.pushable && !r.subset),
  };
}

function tableRow(label, h) {
  return `| ${label} | ${h.n} | ${pct(h.exact, h.n)} | ${pct(h.subset, h.n)} | ${pct(h.pushable, h.n)} | ${pct(h.held, h.n)} | ${pct(h.pushableWrong, h.n)} |`;
}
const TABLE_HEAD =
  "| | cases | exact | generated ⊆ billed | pushable | held | pushable but wrong |\n|---|---:|---:|---:|---:|---:|---:|";

/** One case's diff as "generated X / lab billed Y". Open lines read as "hold:<mapKey>". */
export function signature(r) {
  const gen = [codeBag(r.extra.map((l) => l.code)), ...[...new Set(r.open)].map((k) => `hold:${k}`)].filter(Boolean).join(" + ");
  const lab = codeBag(r.missing.map((l) => l.code));
  return `generated ${gen || "—"} / lab billed ${lab || "—"}`;
}

/**
 * Atomic diffs: one entry per distinct extra code, missing code and hold in a
 * case. Case signatures mix unrelated problems; these isolate each one.
 */
function atoms(r) {
  const out = [];
  const qty = (list) => list.reduce((m, l) => m.set(l.code, (m.get(l.code) || 0) + 1), new Map());
  for (const [code, k] of qty(r.extra)) out.push({ kind: "extra", code, k, name: r.extra.find((l) => l.code === code).name });
  for (const [code, k] of qty(r.missing)) out.push({ kind: "missing", code, k, name: r.missing.find((l) => l.code === code).name });
  for (const key of new Set(r.open)) out.push({ kind: "hold", key });
  return out;
}
const atomLabel = (a) =>
  a.kind === "hold"
    ? `held for staff: \`${a.key}\``
    : a.kind === "extra"
      ? `generated ${a.code}${a.k > 1 ? `×${a.k}` : ""} ${a.name ?? ""} / lab billed —`
      : `generated — / lab billed ${a.code}${a.k > 1 ? `×${a.k}` : ""} ${a.name ?? ""}`;

function count(list, keyFn) {
  const m = new Map();
  for (const x of list) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, { k, n: 0, items: [] });
    const e = m.get(k);
    e.n++;
    e.items.push(x);
  }
  return [...m.values()].sort((a, b) => b.n - a.n || a.k.localeCompare(b.k));
}

export function renderReport(rows, { input, overrides = 0 } = {}) {
  const out = [];
  const h = headline(rows);
  out.push("# Rx replay report", "");
  out.push(
    `${h.n} real prescriptions (${rows.filter((r) => r.form === "rx").length} Rx 2025, ${rows.filter((r) => r.form === "ortho").length} ortho) replayed through jotformToPortalAnswers → buildFormDevices → linesForDevices (the submit path's line seeding, incl. case lab services), ${overrides ? `${overrides} code overrides` : "no rx_code_overrides (static tables only)"}.`,
    ""
  );
  // Mismatch patterns.
  const wrong = rows.filter((r) => !r.exact);
  const allAtoms = wrong.flatMap((r) =>
    atoms(r).map((a) => {
      const c = classify(a, r);
      return { ...a, r, label: atomLabel(a), cls: c.cls, note: c.note };
    })
  );
  // One pattern = one difference under one classification (the same code can
  // be a mapping bug in one context and lab variance in another).
  const atomGroups = count(allAtoms, (a) => `${a.label}\u0000${a.cls}\u0000${a.note}`).map((g) => ({
    ...g,
    k: g.items[0].label,
    cls: { cls: g.items[0].cls, note: g.items[0].note },
  }));

  const byClass = (cls) => new Set(allAtoms.filter((a) => a.cls === cls).map((a) => a.r.index));
  const mappingCases = byClass("mapping bug");
  const translatorCases = byClass("translator bug");
  const varianceOnly = wrong.filter((r) => !mappingCases.has(r.index) && !translatorCases.has(r.index) && !byClass("unclassified").has(r.index)).length;
  out.push("## Overall", "");
  out.push(`- **Exact** (generated == billed, nothing held): ${h.exact}/${h.n} = **${pct(h.exact, h.n)}** (${pct(h.exactStrictArch, h.n)} if arch-less lines must also agree on arch)`);
  out.push(`- **Every generated line is on the lab's order**: ${h.subset}/${h.n} = **${pct(h.subset, h.n)}**`);
  out.push(`- **Pushable** (canPush ok — no open lines, has an appliance): ${h.pushable}/${h.n} = **${pct(h.pushable, h.n)}**`);
  out.push(`- **Held** for staff: ${h.held}/${h.n} = **${pct(h.held, h.n)}**`);
  out.push(`- Pushable AND exact: ${h.pushableExact}/${h.n} = ${pct(h.pushableExact, h.n)}; pushable but carrying a line the lab did not bill: ${h.pushableWrong}/${h.n} = ${pct(h.pushableWrong, h.n)}`);
  out.push(`- Exact once lab variance is set aside (every difference is something the form cannot know): ${h.exact + varianceOnly}/${h.n} = **${pct(h.exact + varianceOnly, h.n)}**`);
  out.push(`- Cases touched by a mapping bug or open ruling: ${mappingCases.size}/${h.n} = ${pct(mappingCases.size, h.n)}; by a translator bug: ${translatorCases.size}`);
  out.push("");

  out.push("## By device family", "", TABLE_HEAD);
  for (const g of count(rows, (r) => r.family)) out.push(tableRow(`${g.k}`, headline(g.items)));
  out.push("");
  out.push("### By device (a multi-device case counts under each of its devices)", "", TABLE_HEAD);
  const keys = [...new Set(rows.flatMap((r) => r.deviceKeys))].sort();
  for (const k of keys) out.push(tableRow(k, headline(rows.filter((r) => r.deviceKeys.includes(k)))));
  out.push("");

  out.push("## Top mismatch patterns", "");
  out.push(
    `${wrong.length} cases are not exact. Each is split into atomic differences (one per code the portal generated that the lab did not bill, per code the lab billed that the portal did not generate, and per held selection). Top 15, with the most common other side of the same cases:`,
    ""
  );
  out.push("| # | pattern | cases | class | what the same cases had on the other side | note |", "|---:|---|---:|---|---|---|");
  atomGroups.slice(0, 15).forEach((g, i) => {
    const other = count(
      g.items.flatMap((a) => atoms(a.r).filter((b) => b.kind !== a.kind || b.code !== a.code || b.key !== a.key)),
      atomLabel
    )
      .slice(0, 2)
      .map((o) => `${o.k.replace(/\s+\/\s+lab billed —|generated —\s+\/\s+/g, "")} (${o.n})`)
      .join("; ");
    out.push(`| ${i + 1} | ${g.k} | ${g.n} | ${g.cls.cls} | ${other || "—"} | ${g.cls.note} |`);
  });
  out.push("");

  for (const cls of ["translator bug", "mapping bug", "lab variance", "unclassified"]) {
    const gs = atomGroups.filter((g) => g.cls.cls === cls);
    if (!gs.length) continue;
    out.push(`### ${cls} — ${gs.reduce((s, g) => s + g.n, 0)} differences in ${new Set(gs.flatMap((g) => g.items.map((a) => a.r.index))).size} cases`, "");
    for (const g of gs.slice(0, 25)) out.push(`- ${g.k} — **${g.n}** case${g.n === 1 ? "" : "s"}. ${g.cls.note}`);
    if (gs.length > 25) out.push(`- … ${gs.length - 25} more, each ≤ ${gs[25].n} cases`);
    out.push("");
  }

  out.push("## Whole-case signatures (top 15)", "", "| cases | signature |", "|---:|---|");
  for (const g of count(wrong, signature).slice(0, 15)) out.push(`| ${g.n} | ${g.k} |`);
  out.push("");

  const warn = count(rows.flatMap((r) => r.warnings), (w) => w);
  out.push("## Translator warnings", "");
  if (!warn.length) out.push("None — every JotForm literal landed on a portal option.");
  for (const g of warn) out.push(`- ${g.k} — ${g.n}`);
  out.push("");
  out.push(`_Input: ${input ?? "(stdin)"}_`, "");
  return out.join("\n");
}
