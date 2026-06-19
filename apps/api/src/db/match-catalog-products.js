/**
 * READ-ONLY catalog → Seazona auto-matcher (bootstrap helper).
 *
 *   node --env-file=.env src/db/match-catalog-products.js
 *
 * Fetches the live Seazona product list and fuzzy-matches each storefront SKU in
 * apps/web/src/data/catalog.js (the old 3dcart catalog) against it, so an admin
 * can confirm the catalogId mapping in one pass instead of hand-mapping ~54 rows.
 *
 * This script makes NO database writes and NO Seazona writes — it only reads
 * Seazona products and prints a proposed mapping. It also writes the proposal to
 * catalog-mapping-proposal.json next to this file for a later apply step.
 *
 * Matching: exact code match first (catalog id === seazona code), then a fuzzy
 * score = token-overlap(name) + price-proximity bonus. Each catalog item gets a
 * confidence tier so a human knows which ones to eyeball.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as seazonaService from "../services/seazona.service.js";
import { SEED_CATALOG } from "../../../web/src/data/catalog.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- text + price normalization ---------------------------------------------

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "for", "with", "to", "pk", "pcs", "pc",
  "pack", "box", "amt", "1", "single", "each", "size", "one",
]);

function normName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")   // drop parentheticals (sizes, counts)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(s) {
  return normName(s)
    .split(" ")
    .filter((t) => t && !STOPWORDS.has(t));
}

/** Jaccard-ish token overlap, weighted toward the shorter (catalog) side. */
function nameScore(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  // recall against the catalog item's tokens + Jaccard, averaged
  const recall = inter / A.size;
  const jaccard = inter / (A.size + B.size - inter);
  return 0.6 * recall + 0.4 * jaccard;
}

function priceScore(a, b) {
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
  if (x === y) return 1;
  const max = Math.max(Math.abs(x), Math.abs(y), 1);
  const diff = Math.abs(x - y) / max;
  return diff <= 0.2 ? 1 - diff : 0; // within 20% gets partial credit
}

// ---- matcher ----------------------------------------------------------------

async function run() {
  const remote = await seazonaService.listProducts();
  console.log(`Fetched ${remote.length} products from Seazona\n`);
  if (remote.length === 0) {
    console.error(
      "Seazona returned 0 products — likely a credential/connectivity failure. Aborting.",
    );
    process.exit(1);
  }

  const codeIndex = new Map();
  for (const p of remote) {
    if (p.code != null && p.code !== "") {
      codeIndex.set(String(p.code).toLowerCase().trim(), p);
    }
  }

  const proposals = [];

  for (const c of SEED_CATALOG) {
    // 1) exact code match: old 3dcart SKU id === Seazona product code
    const codeHit = codeIndex.get(String(c.id).toLowerCase().trim());

    let best = null;
    let bestScore = 0;
    let runnerUp = null;
    if (codeHit) {
      best = codeHit;
      bestScore = 1; // treat exact code as top confidence
    } else {
      for (const p of remote) {
        const ns = nameScore(c.name, p.name);
        const ps = priceScore(c.price, p.price);
        const score = ns + 0.25 * ps; // name dominates, price nudges
        if (score > bestScore) {
          runnerUp = best ? { p: best, score: bestScore } : runnerUp;
          best = p;
          bestScore = score;
        } else if (best && (!runnerUp || score > runnerUp.score)) {
          runnerUp = { p, score };
        }
      }
    }

    let tier;
    if (codeHit) tier = "exact-code";
    else if (bestScore >= 0.85) tier = "high";
    else if (bestScore >= 0.5) tier = "medium";
    else tier = "low";

    proposals.push({
      catalogId: c.id,
      catalogName: c.name,
      catalogPrice: c.price,
      seazonaProductId: best ? String(best.id) : null,
      seazonaCode: best?.code ?? null,
      seazonaName: best?.name ?? null,
      seazonaPrice: best?.price ?? null,
      score: Number(bestScore.toFixed(3)),
      tier,
      runnerUp: runnerUp
        ? { name: runnerUp.p.name, score: Number(runnerUp.score.toFixed(3)) }
        : null,
    });
  }

  // ---- report ----
  const byTier = (t) => proposals.filter((p) => p.tier === t);
  const order = ["exact-code", "high", "medium", "low"];
  const label = {
    "exact-code": "EXACT CODE MATCH",
    high: "HIGH CONFIDENCE",
    medium: "MEDIUM — review",
    low: "LOW / NO MATCH — review",
  };

  for (const t of order) {
    const rows = byTier(t);
    if (!rows.length) continue;
    console.log(`\n=== ${label[t]} (${rows.length}) ===`);
    for (const r of rows) {
      console.log(
        `  [${r.catalogId}] ${r.catalogName} ($${r.catalogPrice})\n` +
          `      → ${r.seazonaName ?? "(none)"} ` +
          `[id ${r.seazonaProductId ?? "—"}, code ${r.seazonaCode ?? "—"}, $${r.seazonaPrice ?? "—"}] ` +
          `score=${r.score}` +
          (r.runnerUp ? `   (runner-up: ${r.runnerUp.name} @ ${r.runnerUp.score})` : ""),
      );
    }
  }

  const summary = {
    "exact-code": byTier("exact-code").length,
    high: byTier("high").length,
    medium: byTier("medium").length,
    low: byTier("low").length,
    total: proposals.length,
  };
  console.log(`\n=== SUMMARY ===`);
  console.log(`  exact-code: ${summary["exact-code"]}`);
  console.log(`  high:       ${summary.high}`);
  console.log(`  medium:     ${summary.medium}`);
  console.log(`  low:        ${summary.low}`);
  console.log(`  total:      ${summary.total}`);
  console.log(
    `\n  Auto-applicable (exact-code + high): ${summary["exact-code"] + summary.high}` +
      `   |   Needs review (medium + low): ${summary.medium + summary.low}`,
  );

  const outPath = join(__dirname, "catalog-mapping-proposal.json");
  writeFileSync(outPath, JSON.stringify({ summary, proposals }, null, 2));
  console.log(`\nProposal written to ${outPath}`);
}

run().catch((err) => {
  console.error("Matcher failed:", err);
  process.exit(1);
});
