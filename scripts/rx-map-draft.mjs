#!/usr/bin/env node
/**
 * scripts/rx-map-draft.mjs
 *
 * READ-ONLY fuzzy-matcher: compares each wizard device/modification label
 * against the live Seazona product catalog and writes a draft mapping report.
 *
 * Run from repo root:
 *   node --env-file=.env scripts/rx-map-draft.mjs
 *
 * Outputs:
 *   • console: per-label top-3 matches + summary
 *   • docs/rx-forms/rx-map-draft.md: lab-verification report
 *
 * NEVER writes to Seazona. No destructive operations.
 */

import { listProducts } from "../apps/api/src/services/seazona.service.js";
import {
  DEVICE_MAP,
  MODIFICATION_MAP,
  LAB_SERVICE_CODES,
} from "../apps/api/src/services/rx/device-seazona-map.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = join(__dirname, "../docs/rx-forms/rx-map-draft.md");

// ---------------------------------------------------------------------------
// Build the flat label list from all three map objects
// ---------------------------------------------------------------------------
const labels = [];

// DEVICE_MAP primaries (keyed by baseMaterial / variant / "default")
for (const [deviceKey, dev] of Object.entries(DEVICE_MAP)) {
  for (const [matKey, entry] of Object.entries(dev.primary)) {
    labels.push({
      source:      `DEVICE_MAP["${deviceKey}"].primary["${matKey}"]`,
      label:       entry.name,
      currentCode: entry.code,
    });
  }
}

// MODIFICATION_MAP
for (const [modKey, entry] of Object.entries(MODIFICATION_MAP)) {
  labels.push({
    source:      `MODIFICATION_MAP["${modKey}"]`,
    label:       entry.name,
    currentCode: entry.code,
  });
}

// LAB_SERVICE_CODES
for (const [svcKey, entry] of Object.entries(LAB_SERVICE_CODES)) {
  labels.push({
    source:      `LAB_SERVICE_CODES["${svcKey}"]`,
    label:       entry.name,
    currentCode: entry.code,
  });
}

// ---------------------------------------------------------------------------
// Fuzzy scoring
// ---------------------------------------------------------------------------
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "of", "to", "in", "on",
  "with", "per", "only", "see", "notes",
]);

function normalize(str) {
  // Guard against non-string catalog rows (e.g. {name: null}) so one
  // malformed Seazona product doesn't crash the whole report.
  if (typeof str !== "string") return "";
  return str
    .toLowerCase()
    .replace(/[/\-_()[\].,;!?'"``]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(str) {
  return normalize(str).split(" ").filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/**
 * Score how well `candidateName` matches `labelName`.
 * Returns a non-negative float; higher = better match.
 */
function fuzzyScore(labelName, candidateName) {
  const lToks = tokenize(labelName);
  const cToks = tokenize(candidateName);

  if (!lToks.length || !cToks.length) return 0;

  const lSet = new Set(lToks);
  const cSet = new Set(cToks);

  let tokenScore = 0;
  for (const lt of lSet) {
    if (cSet.has(lt)) {
      tokenScore += 1.0;
      continue;
    }
    // Partial: one token contains the other (min 3 chars to avoid noise)
    for (const ct of cSet) {
      if (lt.length >= 3 && ct.length >= 3 && (ct.includes(lt) || lt.includes(ct))) {
        tokenScore += 0.35;
        break;
      }
    }
  }

  // Normalize by union to produce a Jaccard-like ratio
  const union = new Set([...lSet, ...cSet]);
  const jaccardLike = tokenScore / union.size;

  // Bonus for substring containment at the full normalized string level
  const lNorm = normalize(labelName);
  const cNorm = normalize(candidateName);
  let subBonus = 0;
  if (cNorm === lNorm) subBonus = 1.0;
  else if (cNorm.includes(lNorm) || lNorm.includes(cNorm)) subBonus = 0.4;

  return jaccardLike + subBonus;
}

/**
 * Return the top-N catalog entries ranked by fuzzy score against `labelName`.
 */
function topMatches(labelName, catalog, n = 3) {
  return catalog
    .map((p) => ({ product: p, score: fuzzyScore(labelName, p.name) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

/**
 * High-confidence: top match scores >= 0.6 AND is at least 1.5× the second best.
 * This is intentionally conservative — ambiguous beats a wrong code every time.
 */
function isHighConfidence(matches) {
  if (!matches.length) return false;
  const top    = matches[0].score;
  const second = matches[1]?.score ?? 0;
  return top >= 0.6 && (second < 0.001 || top / second >= 1.5);
}

// ---------------------------------------------------------------------------
// Fetch catalog (READ-ONLY)
// ---------------------------------------------------------------------------
console.log("Fetching Seazona product catalog…");
let catalog;
try {
  catalog = await listProducts();
} catch (err) {
  console.error("BLOCKED: listProducts() threw →", err.message ?? err);
  process.exit(1);
}

if (!catalog.length) {
  console.error("BLOCKED: Seazona returned 0 products. Check SEAZONA_API_KEY / SEAZONA_SECRET / SEAZONA_BASE_URL.");
  process.exit(1);
}

console.log(`Catalog: ${catalog.length} products loaded.`);
console.log(`Labels to match: ${labels.length}`);
console.log("");

// ---------------------------------------------------------------------------
// Match every label
// ---------------------------------------------------------------------------
const results = labels.map((entry) => {
  const matches = topMatches(entry.label, catalog);
  return { ...entry, matches, highConfidence: isHighConfidence(matches) };
});

// ---------------------------------------------------------------------------
// Console output — one block per label
// ---------------------------------------------------------------------------
for (const r of results) {
  const badge = r.highConfidence ? "✓ HI" : "?   ";
  console.log(`[${badge}] ${r.label}`);
  console.log(`       current code: ${r.currentCode}`);
  for (const m of r.matches) {
    console.log(`       → [${m.product.code}] ${m.product.name} (score: ${m.score.toFixed(3)})`);
  }
  console.log("");
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const highConf  = results.filter((r) =>  r.highConfidence);
const ambiguous = results.filter((r) => !r.highConfidence);

console.log("=== SUMMARY ===");
console.log(`Total labels:     ${results.length}`);
console.log(`High-confidence:  ${highConf.length}`);
console.log(`Ambiguous/TODO:   ${ambiguous.length}`);
console.log("");
console.log("High-confidence matches:");
for (const r of highConf) {
  const m = r.matches[0];
  console.log(`  ${r.currentCode.padEnd(28)} → [${m.product.code}] ${m.product.name} (score: ${m.score.toFixed(3)})`);
}
if (ambiguous.length) {
  console.log("\nAmbiguous (keep placeholder + TODO verify):");
  for (const r of ambiguous) {
    const m = r.matches[0];
    const hint = m ? `best: [${m.product.code}] ${m.product.name} (${m.score.toFixed(3)})` : "no match";
    console.log(`  ${r.currentCode.padEnd(28)} — ${hint}`);
  }
}

// ---------------------------------------------------------------------------
// Markdown report
// ---------------------------------------------------------------------------
mkdirSync(dirname(REPORT_PATH), { recursive: true });

const now = new Date().toISOString();
const md = [];

md.push("# Rx → Seazona Product Code Draft Mapping");
md.push("");
md.push(`_Generated: ${now}_  `);
md.push(`_Catalog size: ${catalog.length} products_  `);
md.push(`_Labels matched: ${results.length}_`);
md.push("");
md.push("> **STATUS: DRAFT — pending lab verification before any live Seazona order is placed.**");
md.push("> High-confidence entries carry a **recommended code** — this is a suggestion, not a confirmed assignment.");
md.push("> Ambiguous entries must be manually verified before any code is applied to `device-seazona-map.js`.");
md.push("");
md.push("---");
md.push("");
md.push("## Summary");
md.push("");
md.push("| | Count |");
md.push("|---|---|");
md.push(`| Total labels | ${results.length} |`);
md.push(`| High-confidence (recommended) | ${highConf.length} |`);
md.push(`| Ambiguous / TODO verify | ${ambiguous.length} |`);
md.push("");
md.push("---");
md.push("");
md.push("## Label Matches");
md.push("");
md.push("Each section shows: current placeholder code, confidence rating, and top-3 catalog candidates.");
md.push("");

for (const r of results) {
  const tier  = r.highConfidence ? "High" : "Ambiguous";
  const badge = r.highConfidence ? "✅ High" : "⚠️ Ambiguous — TODO verify";
  md.push(`### ${r.label}`);
  md.push("");
  md.push(`- **Source:** \`${r.source}\``);
  md.push(`- **Current placeholder code:** \`${r.currentCode}\``);
  md.push(`- **Confidence tier:** ${badge}`);
  if (r.matches[0]) {
    const note = r.highConfidence ? "" : " _(ambiguous — verify before applying)_";
    md.push(`- **Recommended code:** \`${r.matches[0].product.code}\`${note}`);
  }
  md.push("");
  md.push("| Rank | Seazona Code | Seazona Name | Score |");
  md.push("|---|---|---|---|");
  r.matches.forEach((m, i) => {
    md.push(`| ${i + 1} | \`${m.product.code}\` | ${m.product.name} | ${m.score.toFixed(3)} |`);
  });
  md.push("");
}

md.push("---");
md.push("");
md.push("_End of report. Lab: please review every entry marked ⚠️ AMBIGUOUS and confirm the correct Seazona product code._");

writeFileSync(REPORT_PATH, md.join("\n"), "utf-8");
console.log(`\nReport written → docs/rx-forms/rx-map-draft.md`);
